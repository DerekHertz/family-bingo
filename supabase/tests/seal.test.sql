-- Slice 10, server half: Sealing.
--
-- Acceptance test (PRD §10):
--   Given a Setup Window past its deadline
--   When the seal job runs
--   Then every Board in that Family has sealed_at set, the Year is status = 'active',
--   and editing any Tile returns an error

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- pg_cron has no JWT, and that is the whole difference between the job and a person:
-- seal_year() lets an unauthenticated caller through precisely because the only such
-- caller is the scheduler. Dropping the role without dropping the claims would leave
-- auth.uid() set and test the Organizer path by accident.
create or replace function act_as_cron() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function member_of(name text) returns uuid
language sql stable as $$ select id from members where display_name = name $$;

create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id
   where f.name = family and y.calendar_year = 2027
$$;

create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $$
  select t.id from tiles t join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$$;

-- Alice (Organizer), Theo (Managed), Bob. Theo never writes a single Goal — his Board
-- is the one that proves §10.2.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b9', 'mallory@example.test', '{"full_name":"Mallory"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000b1');
select create_family('Hertzell Family', 'America/New_York');
select create_managed_member((select id from families limit 1), 'Theo');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000b2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000b1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);

-- A second Family whose Setup Window is still open, so "the sweep sealed everything it
-- could find" and "the sweep sealed what was due" are distinguishable assertions.
select act_as('00000000-0000-4000-8000-0000000000b9');
select create_family('Okonkwo Family', 'Europe/London');
select open_year((select id from families where name = 'Okonkwo Family'), 2027);

-- Alice authors a Goal. Bob authors nothing but position 0. Theo authors nothing at all.
select act_as('00000000-0000-4000-8000-0000000000b1');
select write_goal(tile_of('Alice', 0), 'Walk every day', 144, 'walks');
select act_as('00000000-0000-4000-8000-0000000000b2');
select write_goal(tile_of('Bob', 0), 'Read more', 12, 'books');

-- ---------------------------------------------------------------------------------
-- Before the deadline nothing seals — not even for the Organizer
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$select seal_year(year_of('Hertzell Family'))$$,
  'PT403', null,
  'the Organizer cannot seal early — the date decides, for them as much as anyone (§10.1)');

select act_as_cron();
select is(seal_due_boards(), 0, 'and the sweep finds nothing due');
select is((select count(*) from boards where sealed_at is not null)::int, 0,
  'so no Board is sealed');

-- ---------------------------------------------------------------------------------
-- The Setup Window closes
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where id = year_of('Hertzell Family');

select act_as('00000000-0000-4000-8000-0000000000b9');
select throws_ok(
  $$select seal_year(year_of('Hertzell Family'))$$,
  '42501', null,
  'someone outside the Family cannot seal it either');

-- The job runs.
select act_as_cron();
select is(seal_due_boards(), 3, 'the seal job seals all 3 Boards');

select is((select count(*) from boards b
            where b.year_id = year_of('Hertzell Family') and b.sealed_at is null)::int,
  0, 'every Board in that Family has sealed_at set');

select is((select status from years where id = year_of('Hertzell Family')), 'active',
  'and the Year is active');

select isnt((select sealed_at from years where id = year_of('Hertzell Family')), null,
  'with the Year stamped too');

-- §10.2: sealing happens whether or not authoring is complete.
select is(
  (select count(*) from tiles t join boards b on b.id = t.board_id
    where b.member_id = member_of('Theo') and t.goal_id is null)::int,
  25,
  'an unfinished Board seals with empty Tiles rather than holding the Family up (§10.2)');

-- The Center Vote resolved on the way past — a Board sealed before resolution would be
-- a Board sealed with an empty centre (api.md §7).
select isnt((select center_mode from years where id = year_of('Hertzell Family')), 'undecided',
  'the Center Vote resolved as part of sealing, not after it');

-- The other Family is untouched.
select is((select status from years where id = year_of('Okonkwo Family')), 'setup',
  'a Family whose Setup Window is still open is left alone');
select is((select count(*) from boards b
            where b.year_id = year_of('Okonkwo Family') and b.sealed_at is not null)::int,
  0, 'and none of its Boards are sealed');

-- ---------------------------------------------------------------------------------
-- §10.3 — after sealing, a Tile is immutable except through a Swap
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$select write_goal(tile_of('Alice', 1), 'Too late', 5)$$,
  'PT403', null,
  'writing a Goal onto a sealed Board is refused (§10.3)');

select throws_ok(
  $$select write_goal(tile_of('Alice', 0), 'Walk twice a day', 300)$$,
  'PT403', null,
  'and so is changing one that is already there');

select throws_ok(
  $$select clear_goal(tile_of('Alice', 0))$$,
  'PT403', null,
  'and so is emptying it');

-- Nor can the client go round the RPC. `goals` is readable and has no write policy and
-- no UPDATE grant, so this is refused a whole level below RLS — there is no client
-- write path to a Goal at all, sealed or not.
select throws_ok(
  $$update goals set target = 1 where id = (select goal_id from tiles where id = tile_of('Alice', 0))$$,
  '42501', null,
  'and a direct UPDATE never reaches RLS — authenticated has no write grant on goals');

-- ---------------------------------------------------------------------------------
-- §10.4 — idempotent and safe to re-run
-- ---------------------------------------------------------------------------------

select act_as_cron();
select is(seal_due_boards(), 0, 'a second sweep seals nothing');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok($$select seal_year(year_of('Hertzell Family'))$$,
  'and sealing an already-sealed Year is a no-op, not an error (§10.4)');

select set_config('role', 'postgres', true);
select is((select count(distinct sealed_at) from boards
            where year_id = year_of('Hertzell Family'))::int,
  1, 'the original sealed_at stamps are not moved by the re-run');

select * from finish();
rollback;
