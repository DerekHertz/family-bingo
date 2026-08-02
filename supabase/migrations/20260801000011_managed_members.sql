-- Slice 4, server half — a child joins without a login.
--
-- Children are the best participants in a family bingo and the entire compliance surface
-- of the app (ADR-0003). A nine-year-old has no email address and cannot complete a
-- verification flow, so they get no Account at all: a Guardian creates the profile under
-- their own login, which makes parental consent INHERENT rather than bolted on.
--
-- The schema already forbids a Managed Member having a login of their own —
-- member_has_exactly_one_backer means account_id IS NULL whenever guardian_account_id is
-- set. The two constraints below close the rest of §4.4.

-- §4.4: a Managed Member "cannot be invited or promoted". Promotion is the one that
-- needs saying in the schema — an Organizer administers a Family, and administering
-- through a Guardian's session would put a child's name on invitations and approvals
-- that an adult actually performed.
alter table members add constraint managed_member_is_never_organizer
  check (guardian_account_id is null or role = 'member');

-- FRONTEND_DESIGN §4.7: "Managed Members receive no notifications." A Digest is a push,
-- and there is no device to send it to — the Guardian's Account has its own preference.
alter table members add constraint managed_member_takes_no_digest
  check (guardian_account_id is null or digest_opt_in = false);

-- Create a child profile under the caller's Account.
--
-- SECURITY DEFINER for the same reason as create_family: `members` has no INSERT policy,
-- because membership creation is the privileged operation in this schema.
--
-- The guard is "an active ADULT Member of this Family". Adulthood here means backed by
-- an Account rather than by a Guardian — a Managed Member must not be able to create
-- further Managed Members, since a Guardian is accountable for everything posted under
-- the profiles they create (§4.3) and a chain of them has no accountable adult at the
-- end of it.
create or replace function create_managed_member(family_id uuid, display_name text)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  trimmed text := btrim(display_name);
  occupied int;
  created members;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from members m
     where m.family_id = create_managed_member.family_id
       and m.account_id = caller
       and m.status = 'active'
  ) then
    raise exception 'only an active Member of this Family may add a child profile'
      using errcode = '42501';
  end if;

  if char_length(coalesce(trimmed, '')) not between 1 and 60 then
    raise exception 'a name must be 1 to 60 characters' using errcode = '22023';
  end if;

  select
    (select count(*) from members m
      where m.family_id = create_managed_member.family_id
        and m.status in ('pending', 'active'))
  + (select count(*) from invitations i
      where i.family_id = create_managed_member.family_id
        and i.used_at is null and i.revoked_at is null and i.expires_at > now())
  into occupied;

  if occupied >= family_seat_limit() then
    raise exception 'this Family is full (% of %)', occupied, family_seat_limit()
      using errcode = 'PT409';
  end if;

  -- account_id stays NULL: no email, no password, no session, nothing to sign in with.
  -- status is 'active' immediately — there is nobody to approve a profile that an
  -- existing Member vouched for by creating it.
  insert into members (family_id, guardian_account_id, display_name, role, status)
  values (create_managed_member.family_id, caller, trimmed, 'member', 'active')
  returning * into created;

  return created;
end;
$$;

-- Remove a child profile.
--
-- §4.5: this deletes their Board, Goals, Increments and Attachments — the FK cascade and
-- the orphaned-Goal trigger from slice 1 do the work. A Guardian may remove a profile
-- they created without needing to be the Organizer, because they are the accountable
-- adult for it (§4.3); the Organizer keeps their own roster power through remove_member.
create or replace function remove_managed_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target members;
begin
  select * into target from members where id = remove_managed_member.member_id;

  if target.id is null
     or target.guardian_account_id is null
     or (target.guardian_account_id <> auth.uid()
         and not is_organizer_of(target.family_id))
  then
    -- One error for every refusal, so an outsider cannot use this to discover whether a
    -- Member exists or who guards them.
    raise exception 'only their Guardian or the Organizer may remove a child profile'
      using errcode = '42501';
  end if;

  delete from members where id = remove_managed_member.member_id;
end;
$$;

revoke execute on function create_managed_member(uuid, text) from public, anon;
revoke execute on function remove_managed_member(uuid) from public, anon;
grant execute on function create_managed_member(uuid, text) to authenticated;
grant execute on function remove_managed_member(uuid) to authenticated;
