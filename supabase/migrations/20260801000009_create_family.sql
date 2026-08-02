-- Slice 2, server half — a Family comes into existence with an Organizer already in it.
--
-- PRD §2.1: creating a Family creates the creator's Member row with role = 'organizer'
-- IN THE SAME TRANSACTION. A Family with no Members is unreachable forever — nobody can
-- see it (visible_family_ids() is empty for everyone) and nobody can be invited into it
-- (create_invitation is Organizer-only). Two statements from a client would leave exactly
-- that row behind on any failure between them, which is why this is an RPC.

-- The name to put on a Member row when the Member is the Account holder themselves.
--
-- Nothing asks the user for this. FRONTEND_DESIGN §4.5 is explicit that Family creation
-- is "one field. Name only" — so the Organizer's own display name has to come from the
-- identity provider. Apple and Google both supply one at sign-up; the email local part
-- is the fallback, and 'Member' is the floor so the NOT NULL can never be the thing that
-- fails a sign-up.
create or replace function account_display_name(target_account_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Member')
  from auth.users u
   where u.id = target_account_id;
$$;

-- Create a Family and its Organizer together.
--
-- SECURITY DEFINER, deliberately, and for the reason written into
-- 20260801000005_rls.sql: `members` has no INSERT policy at all, because any self-insert
-- policy permissive enough to write an `active` `organizer` row here would also let
-- anyone write themselves one in a Family whose id they guessed. Membership creation is
-- the privileged operation in this schema, so it lives in functions like this one, which
-- can check for themselves.
--
-- The guard is simply "is anyone signed in" — an Account may create as many Families as
-- it likes (§2.2), and names are not unique, because two unrelated Smith Families are
-- fine (§2.3).
create or replace function create_family(name text, timezone text default 'UTC')
returns families
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  trimmed text := btrim(name);
  created families;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if char_length(coalesce(trimmed, '')) not between 1 and 60 then
    raise exception 'a Family name must be 1 to 60 characters'
      using errcode = '22023';
  end if;

  -- Every Family has an IANA timezone, and Setup Window deadlines, Freeze and Digests
  -- all resolve in it (§8.3 T1). A bad zone here would not surface until a pg_cron job
  -- tried to seal a Year, so it is caught at the only moment anyone is watching.
  if not exists (
    select 1 from pg_timezone_names z where z.name = create_family.timezone
  ) then
    raise exception 'unknown IANA timezone: %', create_family.timezone
      using errcode = '22023';
  end if;

  insert into families (name, timezone)
  values (trimmed, create_family.timezone)
  returning * into created;

  insert into members (family_id, account_id, display_name, role, status)
  values (created.id, caller, account_display_name(caller), 'organizer', 'active');

  return created;
end;
$$;

revoke execute on function create_family(text, text) from public, anon;
grant execute on function create_family(text, text) to authenticated;

revoke execute on function account_display_name(uuid) from public, anon;
grant execute on function account_display_name(uuid) to authenticated;
