-- Slice 3, server half: invite and approve.
--
-- The acceptance test (PRD §3):
--   Given an Organizer and a second Account
--   When the Organizer generates an Invitation, the second Account opens the link, and
--   the Organizer taps Approve
--   Then the second Account is a Member with role member, and can see the Family's Boards
--
--   And given the same link is opened a second time by a third Account
--   Then it is rejected as already used

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'sarah@example.test', '{"full_name":"Sarah"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'mallory@example.test', '{"full_name":"Mallory"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a4', 'dave@example.test', '{"full_name":"Dave"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

-- ---------------------------------------------------------------------------------
-- The code itself
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
create temp table invite as
  select * from create_invitation((select id from families limit 1));

select is((select length(code) from invite), 8, 'the code is 8 characters');
select ok((select code !~ '[O0I1]' from invite),
  'the alphabet excludes O, 0, I and 1 — the code gets read aloud across a room');
select ok(
  (select expires_at between now() + interval '6 days' and now() + interval '8 days' from invite),
  'it expires in 7 days (§3.1)');

select ok(
  (select not exists (
     select 1 from invitations i, invite v where i.token_hash = v.code)),
  'only the hash is stored — a database read cannot recover a live code');

-- generate_invitation_code() is internal — authenticated has no EXECUTE on it, which is
-- itself worth asserting before checking the codes it produces.
select throws_ok('select generate_invitation_code()', '42501', null,
  'the code generator is not callable by a client');

select set_config('role', 'postgres', true);
select ok(
  (select count(distinct generate_invitation_code()) = 200
     from generate_series(1, 200)),
  'codes do not collide across 200 draws');

-- ---------------------------------------------------------------------------------
-- The acceptance test: Sarah follows the link, Alice approves.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$select redeem_invitation((select code from invite))$$,
  'the invited Account can follow the link');

-- Checked as postgres: Sarah herself cannot see this row, which is the next assertion.
select set_config('role', 'postgres', true);
select is((select status from members where account_id = '00000000-0000-4000-8000-0000000000a2'),
  'pending', 'following an Invitation creates a PENDING Member, not a Member (§3.2)');
select is((select role from members where account_id = '00000000-0000-4000-8000-0000000000a2'),
  'member', 'with role member, never organizer');

-- §3.2: a pending Member reads nothing. Not the Feed, not Boards, not names.
select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*) from families)::int, 0,
  'PENDING: sarah still sees zero Families — approval is a hard RLS boundary');
select is((select count(*) from members)::int, 0, 'PENDING: and zero Members');

-- Gate one: the link is now spent. A third Account cannot use it.
select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select redeem_invitation((select code from invite))$$,
  'PT410', null,
  'SINGLE-USE: a forwarded link is refused after first use (§3.1)');
select is((select count(*) from members where account_id = '00000000-0000-4000-8000-0000000000a3')::int,
  0, 'SINGLE-USE: and Mallory is not in the Family');

-- Approval.
select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select approve_member((select id from members where account_id = '00000000-0000-4000-8000-0000000000a2'))$$,
  '42501', null,
  'PENDING: sarah cannot approve herself');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$select approve_member(
      (select id from members where account_id = '00000000-0000-4000-8000-0000000000a2'))$$,
  'the Organizer approves (§3.3)');

select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select status from members where account_id = '00000000-0000-4000-8000-0000000000a2'),
  'active', 'the Member is now active');
select is((select count(*) from families)::int, 1,
  'and can now see the Family — the boundary opened at approval, not at redemption');

-- ---------------------------------------------------------------------------------
-- Expiry, revocation, and re-opening your own link
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
create temp table invite2 as
  select * from create_invitation((select id from families limit 1));

update invitations set expires_at = now() - interval '1 second'
 where id = (select invitation_id from invite2);

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select redeem_invitation((select code from invite2))$$,
  'PT410', null,
  'EXPIRED: a link found later is refused (§3.1)');

select act_as('00000000-0000-4000-8000-0000000000a1');
create temp table invite3 as
  select * from create_invitation((select id from families limit 1));
select lives_ok(
  $$select revoke_invitation((select invitation_id from invite3))$$,
  'the Organizer can revoke an unused Invitation (§3.4)');

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select redeem_invitation((select code from invite3))$$,
  'PT410', null,
  'REVOKED: a revoked Invitation is refused');

select throws_ok($$select redeem_invitation('ZZZZZZZZ')$$, 'PT410', null,
  'a code that was never real gives the SAME error — no oracle for probing codes');

-- Re-opening your own link must not burn it for its real recipient.
select act_as('00000000-0000-4000-8000-0000000000a1');
create temp table invite4 as
  select * from create_invitation((select id from families limit 1));
select act_as('00000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$select redeem_invitation((select code from invite4))$$,
  'an existing Member re-opening a link gets their Member back');
select set_config('role', 'postgres', true);
select is((select used_at from invitations where id = (select invitation_id from invite4)), null,
  'and the Invitation is still unused, waiting for whoever it was meant for');

-- ---------------------------------------------------------------------------------
-- Only the Organizer administers the roster
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select create_invitation((select id from families limit 1))$$,
  '42501', null, 'NON-ORGANIZER: an ordinary Member cannot mint an Invitation');
select throws_ok(
  $$select remove_member((select id from members where account_id = '00000000-0000-4000-8000-0000000000a1'))$$,
  '42501', null, 'NON-ORGANIZER: an ordinary Member cannot remove the Organizer');

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select approve_member((select id from members limit 1))$$,
  '42501', null,
  'OUTSIDER: someone in no Family at all cannot approve, and learns nothing either way');

-- ---------------------------------------------------------------------------------
-- A Family must keep an Organizer
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select remove_member((select id from members where account_id = '00000000-0000-4000-8000-0000000000a1'))$$,
  'PT409', null,
  'the last Organizer cannot be removed — the Family would become unadministrable');

select lives_ok(
  $$select remove_member(
      (select id from members where account_id = '00000000-0000-4000-8000-0000000000a2'))$$,
  'but any other Member can be removed at any time (§3.4)');

-- ---------------------------------------------------------------------------------
-- Twenty seats (FRONTEND_DESIGN §4.5)
-- ---------------------------------------------------------------------------------

-- Fill the Family to capacity: 1 Organizer + 19 Managed Members. Seeded as postgres,
-- because `members` deliberately has no INSERT policy for anyone (see the RLS migration).
select set_config('role', 'postgres', true);
insert into members (family_id, guardian_account_id, display_name, role, status)
select (select id from families limit 1), '00000000-0000-4000-8000-0000000000a1',
       'Child ' || n, 'member', 'active'
  from generate_series(1, 19) n;

select is((select count(*) from members)::int, 20, 'the Family is at twenty Members');

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select create_invitation((select id from families limit 1))$$,
  'PT409', null,
  'AT CAPACITY: no new Invitation can be minted. "Full for now."');

-- Removing a Member frees a seat (§4.5) — but an unused Invitation minted earlier is
-- still holding one of its own.
select lives_ok(
  $$select remove_member(
      (select id from members where display_name = 'Child 1'))$$,
  'removing a Member frees a seat');

select throws_ok(
  $$select create_invitation((select id from families limit 1))$$,
  'PT409', null,
  'still full, because an outstanding Invitation holds a seat — which is exactly what '
  'makes "a code already sent is a promise" safe at capacity');

select lives_ok(
  $$select revoke_invitation((select invitation_id from invite4))$$,
  'revoking that Invitation gives its seat back');

select lives_ok(
  $$select create_invitation((select id from families limit 1))$$,
  'and inviting works again');

select * from finish();
rollback;
