-- Slice 3, server half — invite someone, and approve them.
--
-- TWO GATES, and neither covers the other's case (PRD §3.5). Invite links get forwarded
-- into group chats:
--
--   forwarded AFTER first use   -> stopped by single-use
--   forwarded BEFORE first use  -> stopped by Organizer approval
--   found later                 -> stopped by the 7-day expiry
--   wrong person already inside -> stopped by remove_member
--
-- Do not simplify this to one gate. The payload behind the boundary is photographs of
-- children (ADR-0005), and §3.5 says so in as many words.

-- A Family has twenty seats, and an outstanding Invitation holds one (FRONTEND_DESIGN
-- §4.5: "20 Members to a Family, and 20 invitations", rendered as "4 of 20. Sixteen
-- invitations left."). Counting outstanding Invitations against the limit is what makes
-- "outstanding invitations remain valid" safe at capacity — a code already sent is a
-- promise, and it cannot overflow the Family because its seat was reserved when it was
-- minted.
create or replace function family_seat_limit()
returns int
language sql
immutable
as $$ select 20 $$;

-- The code is read aloud across a room, so the alphabet drops O, 0, I and 1
-- (FRONTEND_DESIGN §4.5). Eight characters of a 32-symbol alphabet is 2^40 — ample for
-- something single-use that expires in a week and still needs a human to approve it.
--
-- 256 is divisible by 32, so the modulo is uniform and this needs no rejection sampling.
create or replace function generate_invitation_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
  i int;
begin
  for i in 0..7 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;
  return code;
end;
$$;

create or replace function hash_invitation_code(code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$ select encode(digest(upper(btrim(code)), 'sha256'), 'hex') $$;

-- Mint a single-use, 7-day Invitation. Organizer only (§3.1, §3.4).
--
-- The plaintext code is returned HERE AND NOWHERE ELSE. Only its hash is stored, so a
-- database read — including by the Organizer, whose SELECT policy covers this table —
-- cannot recover a live code. Losing it means minting another, which is cheap.
create or replace function create_invitation(family_id uuid)
returns table (invitation_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_member uuid;
  new_code text := generate_invitation_code();
  occupied int;
begin
  if not is_organizer_of(create_invitation.family_id) then
    raise exception 'only the Organizer may invite' using errcode = '42501';
  end if;

  select id into caller_member from members
   where members.family_id = create_invitation.family_id
     and status = 'active' and role = 'organizer'
     and (account_id = auth.uid() or guardian_account_id = auth.uid())
   limit 1;

  select
    (select count(*) from members m
      where m.family_id = create_invitation.family_id
        and m.status in ('pending', 'active'))
  + (select count(*) from invitations i
      where i.family_id = create_invitation.family_id
        and i.used_at is null and i.revoked_at is null and i.expires_at > now())
  into occupied;

  if occupied >= family_seat_limit() then
    -- "Full for now." No upgrade offer, ever. Removing a Member re-enables it.
    raise exception 'this Family is full (% of %)', occupied, family_seat_limit()
      using errcode = 'PT409';
  end if;

  return query
  insert into invitations (family_id, token_hash, created_by_member_id, expires_at)
  values (create_invitation.family_id, hash_invitation_code(new_code), caller_member,
          now() + interval '7 days')
  returning invitations.id, new_code, invitations.expires_at;
end;
$$;

-- Follow an Invitation. Creates a Member at status = 'pending', which reads NOTHING
-- until an Organizer approves (§3.2 — a hard RLS boundary, not a UI state).
--
-- Every failure returns the SAME error, whether the code is expired, already used,
-- revoked, or was never real. Distinguishing them would turn this into an oracle for
-- probing which codes exist, and the honest UI copy — "This invitation has expired —
-- ask for a new one" (api.md §9) — covers all four cases anyway.
create or replace function redeem_invitation(code text)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  invite invitations;
  existing members;
  joined members;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into invite from invitations
   where token_hash = hash_invitation_code(redeem_invitation.code)
     and used_at is null
     and revoked_at is null
     and expires_at > now()
   for update;

  if invite.id is null then
    raise exception 'this invitation has expired — ask for a new one'
      using errcode = 'PT410';
  end if;

  -- Re-opening your own link must not burn it. Someone who is already in this Family
  -- gets their existing Member back, and the Invitation stays unused for its real
  -- recipient.
  select * into existing from members
   where family_id = invite.family_id and account_id = caller;
  if existing.id is not null then
    return existing;
  end if;

  insert into members (family_id, account_id, display_name, role, status)
  values (invite.family_id, caller, account_display_name(caller), 'member', 'pending')
  returning * into joined;

  update invitations set used_at = now() where id = invite.id;

  return joined;
end;
$$;

-- Gate two. Approval is what stops a link forwarded BEFORE its first use (§3.3).
create or replace function approve_member(member_id uuid)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  target members;
begin
  select * into target from members where id = approve_member.member_id;
  if target.id is null or not is_organizer_of(target.family_id) then
    -- Same error either way: an outsider learns nothing about whether the row exists.
    raise exception 'only the Organizer may approve a Member' using errcode = '42501';
  end if;

  update members set status = 'active'
   where id = approve_member.member_id
  returning * into target;

  return target;
end;
$$;

-- Rejecting a pending join removes the row outright. There is no 'rejected' status: a
-- rejected person who is later genuinely invited should arrive as a fresh Member, not
-- carry a tombstone around their Family forever.
create or replace function reject_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target members;
begin
  select * into target from members where id = reject_member.member_id;
  if target.id is null or not is_organizer_of(target.family_id) then
    raise exception 'only the Organizer may reject a Member' using errcode = '42501';
  end if;
  if target.status <> 'pending' then
    raise exception 'that Member has already been approved — remove them instead'
      using errcode = 'PT409';
  end if;
  delete from members where id = reject_member.member_id;
end;
$$;

-- §3.4: the Organizer can revoke an unused Invitation.
create or replace function revoke_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invite invitations;
begin
  select * into invite from invitations where id = revoke_invitation.invitation_id;
  if invite.id is null or not is_organizer_of(invite.family_id) then
    raise exception 'only the Organizer may revoke an Invitation' using errcode = '42501';
  end if;
  update invitations set revoked_at = now()
   where id = revoke_invitation.invitation_id and used_at is null;
end;
$$;

-- §3.4: the Organizer can remove a Member at any time.
--
-- With one guard: the last active Organizer cannot be removed. A Family with no
-- Organizer can never open another Year, invite anyone, or approve anyone — it is the
-- same unreachable state that §2.1 exists to prevent, arriving from the other end.
-- Hand the role over first.
create or replace function remove_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target members;
  remaining_organizers int;
begin
  select * into target from members where id = remove_member.member_id;
  if target.id is null or not is_organizer_of(target.family_id) then
    raise exception 'only the Organizer may remove a Member' using errcode = '42501';
  end if;

  if target.role = 'organizer' and target.status = 'active' then
    select count(*) into remaining_organizers from members
     where family_id = target.family_id
       and role = 'organizer' and status = 'active'
       and id <> target.id;
    if remaining_organizers = 0 then
      raise exception 'a Family must keep at least one Organizer'
        using errcode = 'PT409';
    end if;
  end if;

  delete from members where id = remove_member.member_id;
end;
$$;

revoke execute on function create_invitation(uuid)   from public, anon;
revoke execute on function redeem_invitation(text)   from public, anon;
revoke execute on function approve_member(uuid)      from public, anon;
revoke execute on function reject_member(uuid)       from public, anon;
revoke execute on function revoke_invitation(uuid)   from public, anon;
revoke execute on function remove_member(uuid)       from public, anon;
revoke execute on function generate_invitation_code() from public, anon, authenticated;

grant execute on function create_invitation(uuid) to authenticated;
grant execute on function redeem_invitation(text) to authenticated;
grant execute on function approve_member(uuid)    to authenticated;
grant execute on function reject_member(uuid)     to authenticated;
grant execute on function revoke_invitation(uuid) to authenticated;
grant execute on function remove_member(uuid)     to authenticated;
grant execute on function family_seat_limit()     to authenticated;
grant execute on function hash_invitation_code(text) to authenticated;
