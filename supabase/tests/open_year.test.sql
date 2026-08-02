-- Slice 5, server half: open a Year.
--
-- The acceptance test (PRD §5):
--   Given an Organizer in a Family with 3 active Members
--   When they open Year 2027
--   Then a Year exists with status = 'setup' and a deadline of 2027-01-01, and each
--   active Member has a draft Board with 25 empty Tiles

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test', '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');
select create_managed_member((select id from families limit 1), 'Theo');

-- A third active Member, plus a pending one who must NOT get a Board.
select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families limit 1), '00000000-0000-4000-8000-0000000000a2',
   'Bob', 'member', 'active'),
  ((select id from families limit 1), '00000000-0000-4000-8000-0000000000a3',
   'Carol', 'member', 'pending');

-- ---------------------------------------------------------------------------------
-- The deadline rule (§5.2), checked directly before it is checked through open_year.
-- ---------------------------------------------------------------------------------

select is(
  setup_deadline_for(2027, 'America/New_York', '2026-12-01T12:00:00Z'),
  '2027-01-01T05:00:00Z'::timestamptz,
  'the Setup Window ends at midnight on 1 January in the Family timezone');

select is(
  setup_deadline_for(2027, 'Asia/Tokyo', '2026-12-01T12:00:00Z'),
  '2026-12-31T15:00:00Z'::timestamptz,
  'a Tokyo Family seals nine hours before a UTC one');

select is(
  setup_deadline_for(2027, 'UTC', '2026-12-30T09:00:00Z'),
  '2027-01-06T09:00:00Z'::timestamptz,
  'opened late, the window is still 7 days — a Family formed on 30 December is not '
  'given two days to write 24 Goals (§5.2)');

select is(
  setup_deadline_for(2027, 'UTC', '2026-12-25T00:00:00Z'),
  '2027-01-01T00:00:00Z'::timestamptz,
  'exactly 7 days out still uses 1 January');

select is(
  setup_deadline_for(2027, 'UTC', '2027-03-15T09:00:00Z'),
  '2027-03-22T09:00:00Z'::timestamptz,
  'opened after the Year has begun, the window is 7 days from opening');

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select open_year((select id from families limit 1), 2027)$$,
  'the Organizer opens Year 2027');

select is((select status from years), 'setup', 'the Year is in setup');
select is((select center_mode from years), 'undecided',
  'the Center Tile is undecided until the Family votes (§8)');
select is((select setup_deadline from years), '2027-01-01T05:00:00Z'::timestamptz,
  'with a deadline of 1 January in New York');
select is((select sealed_at from years), null, 'nothing is sealed yet');
select is((select frozen_at from years), null, 'and nothing is frozen');

select is((select count(*) from boards)::int, 3,
  'each of the 3 ACTIVE Members has a Board — Alice, Theo and Bob');
select is((select count(*) from boards b join members m on m.id = b.member_id
            where m.status = 'pending')::int, 0,
  'the pending Member gets none — she can read nothing, so it would only confuse (§3.2)');

select is((select count(*) from tiles)::int, 75, '25 Tiles per Board, 75 in all');
select is((select count(distinct position) from tiles)::int, 25,
  'at positions 0 through 24');
select is((select min(position) from tiles)::int, 0, 'starting at 0');
select is((select max(position) from tiles)::int, 24, 'ending at 24');

select is((select count(*) from tiles where goal_id is not null
             or family_goal_id is not null)::int, 0,
  'every Tile starts empty, including the Center (§6.5)');

select is((select count(*) from boards where sealed_at is not null)::int, 0,
  'every Board is a draft — free editing until it seals');
select is((select swaps_used from boards limit 1), 0, 'with a full Swap budget');

select is((select count(*) from votes)::int, 2, 'both Votes exist');
select is((select count(*) from votes where kind = 'mode')::int, 1, 'one for the mode');
select is((select count(*) from votes where kind = 'goal')::int, 1,
  'and one for the Family Goal, created up front even though it only runs if the '
  'mode resolves to shared (§9.1)');
select is((select count(*) from votes where closes_at <> (select setup_deadline from years))::int,
  0, 'both closing with the Setup Window');

-- ---------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------

select throws_ok($$select open_year((select id from families limit 1), 2027)$$,
  'PT409', null, 'one Year per Family per calendar year (§5.1)');

select throws_ok($$select open_year((select id from families limit 1), 2020)$$,
  '22023', null, 'a Year that has already passed cannot be opened');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok($$select open_year((select id from families limit 1), 2028)$$,
  '42501', null, 'NON-ORGANIZER: an ordinary Member cannot open a Year (§5.1)');

-- Board creation is idempotent (§5.3), which is what lets a late joiner be topped up
-- into an already-open Year in slice 21 without duplicating anything.
select set_config('role', 'postgres', true);
select lives_ok($$
  select ensure_board(
    (select id from members where display_name = 'Theo'),
    (select id from years limit 1))
$$, 'ensure_board can be re-run');
select is((select count(*) from tiles)::int, 75,
  'and creates no duplicate Board or Tiles (§5.3)');

select * from finish();
rollback;
