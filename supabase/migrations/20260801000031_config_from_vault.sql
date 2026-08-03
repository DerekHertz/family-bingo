-- Both halves of the Edge Function wiring come from Vault.
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
create or replace function edge_wiring_status()
returns table (check_name text, status text, detail text)
language sql
stable
security definer
set search_path = public, extensions, net, vault
as $$
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
  select 'last request',
         case when (select count(*) from net._http_response) = 0 then 'NONE SENT'
              when (select status_code from net._http_response
                     order by created desc limit 1) between 200 and 299 then 'ok'
              else 'FAILED' end,
         coalesce((select 'HTTP ' || coalesce(status_code::text, 'no response') ||
                          coalesce(' — ' || left(error_msg, 120), '')
                     from net._http_response order by created desc limit 1),
                  'call invoke_edge_function(''notify'') to send one')
$$;

comment on function edge_wiring_status() is
  'Run after configuring a project. Every failure in this pipeline is silent — an unset '
  'secret returns null and a rejected request fails inside pg_net''s worker — so this is '
  'the only thing that will tell you the push outbox is not draining.';

revoke execute on function invoke_edge_function(text) from public, anon, authenticated;
revoke execute on function edge_wiring_status() from public, anon, authenticated;
