-- Slice 4, server half: Managed Child Profiles.
--
-- The acceptance test (PRD §4):
--   Given an adult Member
--   When they create a child profile named "Theo"
--   Then a Member exists with guardian_account_id set to the adult's Account and no
--   account_id, Theo appears in the Family, and the adult can switch to acting as Theo

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test', '{"full_name":"Bob"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------

select lives_ok(
  $$select create_managed_member((select id from families limit 1), 'Theo')$$,
  'an adult Member can create a child profile');

select is((select display_name from members where display_name = 'Theo'), 'Theo',
  'Theo appears in the Family');
select is((select guardian_account_id from members where display_name = 'Theo'),
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  'guarded by the adult''s Account (§4.1)');
select is((select account_id from members where display_name = 'Theo'), null,
  'with NO account_id — no email, no password, no session (§4.4)');
select is((select role from members where display_name = 'Theo'), 'member',
  'and role member');
select is((select status from members where display_name = 'Theo'), 'active',
  'active immediately — an existing Member vouched for the profile by creating it');

-- "the adult can switch to acting as Theo"
select ok(
  (select id from members where display_name = 'Theo') in (select controlled_member_ids()),
  'the Guardian can act as Theo — Account to Member is one-to-many (ADR-0003)');
select is((select count(*) from controlled_member_ids())::int, 2,
  'the Guardian now drives two Members: herself and Theo');

-- ---------------------------------------------------------------------------------
-- §4.4 — a Managed Member is never promoted, and never notified
-- ---------------------------------------------------------------------------------

-- Two layers refuse this, and both are worth asserting. A client is stopped at the
-- column GRANT before RLS is consulted; the CHECK is what stops a background job, a
-- migration, or an agent — the ones schema.md §3 says conventions will not survive.
select throws_ok($$
  update members set role = 'organizer' where display_name = 'Theo'
$$, '42501', null,
  'a client cannot promote a Managed Member — no column grant on role');

select set_config('role', 'postgres', true);

select throws_ok($$
  update members set role = 'organizer' where display_name = 'Theo'
$$, '23514', null,
  'and neither can anything else: a Managed Member is never an Organizer (§4.4)');

select throws_ok($$
  insert into members (family_id, guardian_account_id, display_name, role)
  values ((select id from families limit 1),
          '00000000-0000-4000-8000-0000000000a1', 'Impossible', 'organizer')
$$, '23514', null, 'nor can one be created as an Organizer');

select throws_ok($$
  update members set digest_opt_in = true where display_name = 'Theo'
$$, '23514', null,
  'and receives no Digest — there is no device to send one to (§4.7)');

select throws_ok($$
  update members set account_id = '00000000-0000-4000-8000-0000000000a2'
   where display_name = 'Theo'
$$, '23514', null,
  'a Managed Member cannot be given a login — exactly one backer, always');

select act_as('00000000-0000-4000-8000-0000000000a1');

-- ---------------------------------------------------------------------------------
-- Who may create one
-- ---------------------------------------------------------------------------------

-- A Managed Member must not create further Managed Members: a Guardian is accountable
-- for everything posted under the profiles they create (§4.3), and a chain of them has
-- no accountable adult at the end.
select is(
  (select count(*) from members m
    where m.family_id = (select id from families limit 1)
      and m.account_id = (select id from members where display_name = 'Theo'))::int,
  0, 'Theo has no Account, so he can never be the caller of anything');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select create_managed_member((select id from families limit 1), 'Intruder')$$,
  '42501', null,
  'CROSS-FAMILY: someone outside the Family cannot add a child to it');

select is((select count(*) from members)::int, 0,
  'CROSS-FAMILY: and still sees nothing of that Family');

-- A pending Member cannot either.
select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status)
values ((select id from families limit 1), '00000000-0000-4000-8000-0000000000a2',
        'Bob', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select create_managed_member((select id from families limit 1), 'Too Early')$$,
  '42501', null,
  'PENDING: an unapproved Member cannot add a child either');

-- ---------------------------------------------------------------------------------
-- Names and seats
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select create_managed_member((select id from families limit 1), '  ')$$,
  '22023', null, 'a blank name is rejected');
select throws_ok(
  $$select create_managed_member((select id from families limit 1), repeat('x', 61))$$,
  '22023', null, 'a name over 60 characters is rejected');

select set_config('role', 'postgres', true);
insert into members (family_id, guardian_account_id, display_name, role, status)
select (select id from families limit 1), '00000000-0000-4000-8000-0000000000a1',
       'Child ' || n, 'member', 'active'
  from generate_series(1, 17) n;

select is((select count(*) from members)::int, 20, 'the Family is at twenty Members');
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select create_managed_member((select id from families limit 1), 'One Too Many')$$,
  'PT409', null, 'a child profile takes a seat like anyone else (§4.5)');

-- ---------------------------------------------------------------------------------
-- Removal takes everything with it (§4.5)
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
insert into years (id, family_id, calendar_year, setup_deadline) values
  ('00000000-0000-4000-8000-0000000000d1', (select id from families limit 1),
   2027, '2027-01-01T05:00:00Z');
insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-0000000000b1',
   (select id from members where display_name = 'Theo'),
   '00000000-0000-4000-8000-0000000000d1', '2027-01-01T05:00:00Z');
insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b1', p from generate_series(0, 24) p;
insert into goals (id, text, target) values
  ('00000000-0000-4000-8000-0000000000ba', 'Learn to swim', 10);
update tiles set goal_id = '00000000-0000-4000-8000-0000000000ba'
 where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0;
insert into increments (id, tile_id, member_id) values
  ('00000000-0000-4000-8000-0000000000c1',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0),
   (select id from members where display_name = 'Theo'));
insert into attachments (increment_id, storage_path) values
  ('00000000-0000-4000-8000-0000000000c1', 'f/c1.jpg');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select remove_managed_member((select id from members where display_name = 'Theo'))$$,
  '42501', null,
  'someone who is not their Guardian cannot remove a child profile');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$select remove_managed_member((select id from members where display_name = 'Theo'))$$,
  'their Guardian can, without needing to be the Organizer (§4.3)');

select set_config('role', 'postgres', true);
select is((select count(*) from boards where id = '00000000-0000-4000-8000-0000000000b1')::int, 0,
  'REMOVAL: the Board goes with them (§4.5)');
select is((select count(*) from goals where id = '00000000-0000-4000-8000-0000000000ba')::int, 0,
  'REMOVAL: their Goals go too');
select is((select count(*) from attachments)::int, 0,
  'REMOVAL: and their photographs');

select * from finish();
rollback;
