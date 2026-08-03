-- Wiring the database to its own Edge Functions.
--
-- Three things were left to be configured by hand after slice 20, and two of them did not
-- have to be. A Database Webhook created by clicking around the dashboard is
-- infrastructure that exists in exactly one place, is invisible in review, and is gone
-- the moment the project is recreated — so the webhook is a trigger here instead, and the
-- credential it needs comes from Vault rather than a plaintext setting.
--
-- What still has to be done by a human, once, is in the project README: putting the
-- service role key into Vault, and setting the functions URL.

-- ---------------------------------------------------------------------------------
-- Where the credential lives
-- ---------------------------------------------------------------------------------
--
-- Vault, not `alter database ... set app.settings.service_role_key`. A database setting
-- is readable by anyone who can query pg_settings and shows up in plan output and error
-- context; the service role key bypasses RLS entirely, so it is the one credential in
-- this system that must never sit in a settings string. `supabase_vault` is already
-- installed and encrypts at rest.
--
-- The URL is not a secret and stays an ordinary setting.
create or replace function invoke_edge_function(function_name text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  secret   text;
begin
  begin
    select decrypted_secret into secret
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception when others then
    -- No Vault (local development), or no such secret yet.
    secret := null;
  end;

  -- Fall back to a setting, so a self-hosted deployment without Vault still has a way in.
  secret := coalesce(secret, current_setting('app.settings.service_role_key', true));

  -- Unset in local development and in tests, where there is no Edge Runtime to call.
  -- Returning rather than raising keeps the cron jobs green instead of filling the log
  -- with failures nobody can act on.
  if base_url is null or secret is null then
    return null;
  end if;

  return net.http_post(
    url     := base_url || '/' || function_name,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || secret),
    body    := '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------------
-- The webhook, as a trigger
-- ---------------------------------------------------------------------------------
--
-- §15's acceptance test says "within 30 seconds". The cron backstop drains once a minute,
-- which does not meet it and was never meant to — the intent was a Database Webhook on
-- `notifications` insert, configured in project settings.
--
-- This is that webhook, written where it can be reviewed and where recreating the project
-- restores it. A Supabase Database Webhook IS a trigger calling net.http_post; going
-- through the dashboard only hides that.
--
-- Statement-level, not per row: complete_family_goal() inserts one row per Member, and a
-- row-level trigger would fire six HTTP requests to drain a queue that one request
-- empties. The function takes no arguments and drains everything pending, so one call per
-- statement is exactly right.
create or replace function drain_notifications_now()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform invoke_edge_function('notify');
  return null;
end;
$$;

create trigger notifications_drain
  after insert on notifications
  for each statement execute function drain_notifications_now();

revoke execute on function drain_notifications_now() from public, anon, authenticated;
revoke execute on function invoke_edge_function(text) from public, anon, authenticated;
