-- Both halves of the Edge Function wiring come from Vault, and pg_net is made explicit.
--
-- pg_net was never created by a migration. The local stack enables it by default and the
-- hosted project does not, so every reference to net.http_post in migrations 29 and 30
-- was resolving only by luck of the environment — and only *seeming* to work, because
-- invoke_edge_function() returns early when Vault is unset and so never reached the call.
-- Configuring the secrets would have turned every cron job into a runtime error at once.
--
-- Extensions are idempotent, so this is safe on a database that already has it.
create extension if not exists pg_net;

--
-- `alter database postgres set app.settings.functions_url = ...` is denied on Supabase:
-- the role the SQL editor runs as is not superuser, and ALTER DATABASE ... SET needs to
-- be. The setting was the wrong home for it anyway — a database-level setting survives
-- neither a project restore nor a branch, and there is already a mechanism here that
-- survives both.
--
-- So the URL joins the key in Vault. It is not a secret and does not need encrypting;
-- what it needs is to be somewhere a migration can rely on and a human can set once.
-- current_setting() stays as a fallback for a self-hosted deployment that has no Vault
-- and can run ALTER DATABASE.
create or replace function invoke_edge_function(function_name text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  base_url text;
  secret   text;
begin
  begin
    select decrypted_secret into base_url
      from vault.decrypted_secrets where name = 'functions_url' limit 1;
    select decrypted_secret into secret
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    base_url := null;
    secret   := null;
  end;

  base_url := coalesce(base_url, current_setting('app.settings.functions_url', true));
  secret   := coalesce(secret,   current_setting('app.settings.service_role_key', true));

  -- Unset in local development and in tests, where there is no Edge Runtime to call.
  -- Returning rather than raising keeps the cron jobs green instead of filling the log
  -- with failures nobody can act on.
  if base_url is null or secret is null then
    return null;
  end if;

  return net.http_post(
    url     := rtrim(base_url, '/') || '/' || function_name,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || secret),
    body    := '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------------
-- Telling whether the wiring took
-- ---------------------------------------------------------------------------------
--
-- Every failure mode here is silent by design: an unset secret returns null, and a
-- rejected request fails inside pg_net's background worker where nothing surfaces it. The
-- combination is a system that looks fine and notifies nobody, which is the worst
-- property a push pipeline can have.
--
-- This is the one query to run after configuring a project. It answers the three
-- questions in order — is it configured, did a request go out, what did the function say.
--
-- plpgsql with a to_regclass guard rather than plain SQL: a `language sql` body has its
-- table references resolved when the function is CREATED, so naming net._http_response
-- directly makes this migration fail outright on any database where pg_net is absent —
-- which is exactly the situation it exists to diagnose.
create or replace function edge_wiring_status()
returns table (check_name text, status text, detail text)
language plpgsql
stable
security definer
set search_path = public, extensions, net, vault
as $fn$
begin
  return query
  select 'functions_url' as check_name,
         case when exists (select 1 from vault.decrypted_secrets where name = 'functions_url')
              then 'set' else 'MISSING' end,
         coalesce((select decrypted_secret from vault.decrypted_secrets
                    where name = 'functions_url' limit 1), 'add it to Vault')
  union all
  -- The value is never shown. A key stored as the literal placeholder is the likeliest
  -- mistake, and its length gives that away without printing anything sensitive.
  select 'service_role_key',
         case when exists (select 1 from vault.decrypted_secrets where name = 'service_role_key')
              then 'set' else 'MISSING' end,
         coalesce((select case
                     when length(decrypted_secret) < 40 then
                       'SUSPICIOUS: only ' || length(decrypted_secret) ||
                       ' chars — did the placeholder get stored literally?'
                     when decrypted_secret like 'eyJ%' then
                       'looks like a JWT (' || length(decrypted_secret) || ' chars) — correct kind'
                     else
                       'set (' || length(decrypted_secret) || ' chars) but not a JWT — see below'
                   end
                   from vault.decrypted_secrets where name = 'service_role_key' limit 1),
                  'add it to Vault')
  union all
  select 'pg_net',
         case when to_regclass('net._http_response') is null then 'MISSING' else 'set' end,
         case when to_regclass('net._http_response') is null
              then 'extension absent — no request can leave the database'
              else 'installed' end;

  -- Read dynamically for the same reason the function is plpgsql at all.
  if to_regclass('net._http_response') is not null then
    return query execute $q$
      select 'last request',
             case when (select count(*) from net._http_response) = 0 then 'NONE SENT'
                  when (select status_code from net._http_response
                         order by created desc limit 1) between 200 and 299 then 'ok'
                  else 'FAILED' end,
             coalesce((select 'HTTP ' || coalesce(status_code::text, 'no response') ||
                              coalesce(' — ' || left(error_msg, 120), '')
                         from net._http_response order by created desc limit 1),
                      'call invoke_edge_function(`notify`) to send one')
    $q$;
  end if;
end;
$fn$;

comment on function edge_wiring_status() is
  'Run after configuring a project. Every failure in this pipeline is silent — an unset '
  'secret returns null and a rejected request fails inside pg_net''s worker — so this is '
  'the only thing that will tell you the push outbox is not draining.';

revoke execute on function invoke_edge_function(text) from public, anon, authenticated;
revoke execute on function edge_wiring_status() from public, anon, authenticated;
