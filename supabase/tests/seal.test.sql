-- Slice 10, server half: Sealing.
--
-- Acceptance test (PRD §10):
--   Given a Setup Window past its deadline
--   When the seal job runs
--   Then every Board in that Family has sealed_at set, the Year is status = 'active',
--   and editing any Tile returns an error

begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

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

-- Both clocks, because open_year() sets them from the same instant and resolution
-- refuses while either Vote is still open (§8.1). Moving only the Year's deadline would
-- leave seal_year() failing inside the sweep's exception handler, silently.
select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where id = year_of('Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Hertzell Family');

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
-- §9.5 — the one Tile whose Setup Window is empty by construction
-- ---------------------------------------------------------------------------------

-- Nobody in this Family voted, so the centre fell back to personal (§8.3) — and the
-- Member only learned that at the instant their Board sealed.
select set_config('role', 'postgres', true);
select is((select center_mode from years where id = year_of('Hertzell Family')), 'personal',
  'zero Ballots resolved the centre to personal (§8.3)');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$select write_goal(tile_of('Alice', 12), 'Learn to sail', 4, 'trips')$$,
  'the personal Center Tile is authored after sealing — the vote deciding it did not '
  'resolve until then (§9.5)');

select is(
  (select g.text from goals g join tiles t on t.goal_id = g.id
    where t.id = tile_of('Alice', 12)),
  'Learn to sail',
  'and the centre holds it, like any other Tile (§9.5)');

select is((select swaps_used from boards where member_id = member_of('Alice')), 0,
  'and it costs no Swap: the Member was never given a chance to write it earlier');

select throws_ok(
  $$select write_goal(tile_of('Alice', 12), 'Actually, learn to ski', 4)$$,
  'PT403', null,
  'but only once — after that it is a sealed Tile like any other');

select throws_ok(
  $$select clear_goal(tile_of('Alice', 12))$$,
  'PT403', null,
  'and emptying it again costs a Swap too');

-- The exception is exactly one Tile wide. It must not have unsealed the Board.
select throws_ok(
  $$select write_goal(tile_of('Alice', 2), 'Sneaking one in', 5)$$,
  'PT403', null,
  'no other Tile became writable alongside it');

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

-- ---------------------------------------------------------------------------------
-- §9.5 with §18.5 — the free write of a personal centre is a window, not an open door
-- ---------------------------------------------------------------------------------
--
-- Bob let his seven days run out. Tile 12 sits on row 2, column 2 and both diagonals,
-- so an unbounded free write would let him wait until November, see which Lines he was
-- one Tile short of, and close one with a target-1 Goal — the manufactured Bingo the
-- Swap budget exists to prevent. Past the deadline his centre is simply an empty Tile
-- on a sealed Board, which §18.5 prices at a Swap like any other.
--
-- Aged after §10.4 above, which asserts every Board still carries the same stamp.
select set_config('role', 'postgres', true);
update boards set sealed_at = now() - interval '8 days'
 where member_id = member_of('Bob');

select act_as('00000000-0000-4000-8000-0000000000b2');
select throws_ok(
  $$select write_goal(tile_of('Bob', 12), 'Too late for the centre', 3)$$,
  'PT403', null,
  'the free write of a personal Center Tile closes seven days after the seal (§9.5, §18.5)');

-- ---------------------------------------------------------------------------------
-- api.md §7 — resolution happens BEFORE the seal, not after
-- ---------------------------------------------------------------------------------
--
-- The Hertzell Family above never voted, so it fell back to personal and could not tell
-- the two orderings apart. This Family votes shared and proposes, so Tile 12 has to
-- carry a Family Goal by the time the Board's sealed_at is stamped. Seal first and every
-- Board in the Family seals with an empty centre.

select set_config('role', 'postgres', true);
select create_family('Okonkwo Family 2028', 'Europe/London');
insert into members (family_id, guardian_account_id, display_name, role, status)
  values ((select id from families where name = 'Okonkwo Family 2028'),
          '00000000-0000-4000-8000-0000000000b9', 'Chidi', 'member', 'active');
select open_year((select id from families where name = 'Okonkwo Family 2028'), 2028);

insert into proposals (id, vote_id, member_id, text)
  select '00000000-0000-4000-8000-0000000000c1',
         v.id, member_of('Chidi'), 'Walk the Ridgeway together'
    from votes v join years y on y.id = v.year_id
   where y.family_id = (select id from families where name = 'Okonkwo Family 2028')
     and v.kind = 'goal';
insert into ballots (vote_id, member_id, choice_mode)
  select v.id, member_of('Chidi'), 'shared'
    from votes v join years y on y.id = v.year_id
   where y.family_id = (select id from families where name = 'Okonkwo Family 2028')
     and v.kind = 'mode';
insert into ballots (vote_id, member_id, proposal_id)
  select v.id, member_of('Chidi'), '00000000-0000-4000-8000-0000000000c1'
    from votes v join years y on y.id = v.year_id
   where y.family_id = (select id from families where name = 'Okonkwo Family 2028')
     and v.kind = 'goal';

update years set setup_deadline = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Okonkwo Family 2028');
update votes set closes_at = now() - interval '1 minute'
 where year_id in (select id from years
                    where family_id = (select id from families where name = 'Okonkwo Family 2028'));

select act_as_cron();
select is(seal_due_boards(), 2, 'the sweep seals the shared-mode Family too');

select is(
  (select fg.text from family_goals fg join years y on y.id = fg.year_id
    where y.family_id = (select id from families where name = 'Okonkwo Family 2028')),
  'Walk the Ridgeway together', 'the Family Goal was created');

select is(
  (select count(*) from tiles t
     join boards b on b.id = t.board_id
     join years y on y.id = b.year_id
    where y.family_id = (select id from families where name = 'Okonkwo Family 2028')
      and t.position = 12 and t.family_goal_id is not null
      and b.sealed_at is not null)::int,
  2,
  'and every sealed Board carries it on Tile 12 — resolution ran BEFORE the seal, not '
  'after it (api.md §7)');

-- ---------------------------------------------------------------------------------
-- §21.1 — the Board that comes due on a clock of its own
-- ---------------------------------------------------------------------------------
--
-- Nothing writes personal_setup_deadline until slice 21. This is the sweep's second
-- pass, which is the only thing that would ever seal a late joiner's Board, so it is
-- tested here rather than left to be discovered in July.

select set_config('role', 'postgres', true);
insert into members (id, family_id, guardian_account_id, display_name, role, status)
  values ('00000000-0000-4000-8000-0000000000cf',
          (select id from families where name = 'Hertzell Family'),
          '00000000-0000-4000-8000-0000000000b1', 'Nia', 'member', 'active');
select ensure_board('00000000-0000-4000-8000-0000000000cf', year_of('Hertzell Family'));
update boards set personal_setup_deadline = now() + interval '7 days'
 where member_id = '00000000-0000-4000-8000-0000000000cf';

select act_as_cron();
select is(seal_due_boards(), 0,
  'a late joiner inside their own seven days is not swept up by the Year (§21.1)');

select set_config('role', 'postgres', true);
update boards set personal_setup_deadline = now() - interval '1 minute'
 where member_id = '00000000-0000-4000-8000-0000000000cf';

select act_as_cron();
select is(seal_due_boards(), 1, 'and seals on their own clock once it runs out');
select isnt((select sealed_at from boards
              where member_id = '00000000-0000-4000-8000-0000000000cf'), null,
  'so no Board is left playable-but-unsealed inside an active Year');

select * from finish();
rollback;
