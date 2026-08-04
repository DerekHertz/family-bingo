-- Slice 11, server half: Logging an Increment.
--
-- Acceptance test (PRD §11):
--   Given a sealed Board with a Goal of target 144
--   When the Member taps the Tile once
--   Then an Increment exists and progress reads 1/144
--
-- The two timing gates of §11.5 that fire on arrival — an unsealed Board, a frozen Year
-- — are proved in rls_write_policies.test.sql, where the rest of the write boundary
-- lives. What is here is the slice's own subject: what a tap does, what it may not be
-- aimed at, and the fact that a Member cannot choose when it happened.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function act_as_cron() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function member_of(name text) returns uuid
language sql stable as $$ select id from members where display_name = name $$;

create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $$
  select t.id from tiles t join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$$;

create or replace function progress_of(name text, pos int) returns int
language sql stable as $$
  select count(*)::int from increments i where i.tile_id = tile_of(name, pos)
$$;

-- Alice and Bob. Alice authors Tiles 0 and 1 and leaves Tile 2 empty, which is a normal
-- state for a sealed Board (§10.2) and not a broken one. Carol belongs to neither and
-- exists only to found the shared-mode Family at the end, so that member_of('Alice')
-- stays a single row throughout.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk every day', 144, 'walks');
select write_goal(tile_of('Alice', 1), 'Read more books', 12, 'books');

-- Nobody votes, so the centre falls back to personal (§8.3) and the Boards seal.
select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id in (select id from years
                    where family_id = (select id from families where name = 'Hertzell Family'));

select act_as_cron();

-- ---------------------------------------------------------------------------------
-- The squares are dealt at seal (§4.1), so from here a Tile is found by its Goal
-- ---------------------------------------------------------------------------------
--
-- `positions are dealt at seal, so no Member can place the easy one in a corner`. Every
-- assertion below means "the Tile carrying the Goal I wrote to that square", never "square
-- N" — so that is what tile_of() now answers. Squares nothing was written to, including
-- the Centre at 12, still resolve literally: that is what the empty-Tile assertions of
-- §10.2 are about.
create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $dealt$
  select coalesce(
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
       join goals  g on g.id = t.goal_id
      where b.member_id = member_of(name)
        and g.text = (select m.txt from (values
                ('Alice', 0, 'Walk every day'),
                ('Alice', 1, 'Read more books'),
                ('Alice', 12, 'Learn to sail')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

select is(seal_due_boards(), 2, 'both Boards seal, and the Year is under way');

-- The personal centre is authored first, while the seal is still fresh: its free write
-- closes seven days after sealing (§9.5 with §18.5), and the Board is about to be aged
-- ninety days.
select act_as('00000000-0000-4000-8000-0000000000a1');
select write_goal(tile_of('Alice', 12), 'Learn to sail', 4, 'trips');

-- Aged so the boundary tests below are distinguishable: without this, sealed_at and
-- now() are the same instant inside one transaction, and "refused for predating the
-- seal" and "clamped back to now" would be indistinguishable assertions.
select set_config('role', 'postgres', true);
update boards set sealed_at = now() - interval '90 days'
 where year_id in (select id from years
                    where family_id = (select id from families where name = 'Hertzell Family'));

-- ---------------------------------------------------------------------------------
-- §11.1, §11.4 — the acceptance test: one tap
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0), member_of('Alice'))
$$, 'one tap logs an Increment — no note, nothing else required (§11.1)');

select is(progress_of('Alice', 0), 1,
  'and progress reads 1 — COUNT(increments), never a stored counter (§11.4)');

select is(
  (select g.target from goals g join tiles t on t.goal_id = g.id
    where t.id = tile_of('Alice', 0)),
  144, 'of 144, which lives on the Goal and was not touched by the tap');

select lives_ok($$
  insert into increments (id, tile_id, member_id, note)
  values ('00000000-0000-4000-8000-0000000000c2', tile_of('Alice', 0), member_of('Alice'),
          'took the long way round the reservoir')
$$, 'a note is optional, and adding one is the same insert (§11.1)');

select is(progress_of('Alice', 0), 2, 'progress reads 2');

-- ---------------------------------------------------------------------------------
-- §11.2, §17.4 — the client UUID is the whole conflict story
-- ---------------------------------------------------------------------------------

-- This is the exact statement the offline queue replays (api.md §8). It has to be a
-- no-op rather than an error, because the queue cannot tell a delivered tap from an
-- undelivered one and will happily send both again.
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0), member_of('Alice'))
  on conflict (id) do nothing
$$, 'replaying a delivered tap is accepted, not an error (§11.2)');

select is(progress_of('Alice', 0), 2, 'and creates no duplicate — progress is unmoved');

-- Three taps logged offline, then the whole queue replayed twice over (§17.1).
select lives_ok($$
  insert into increments (id, tile_id, member_id) values
    ('00000000-0000-4000-8000-0000000000c3', tile_of('Alice', 1), member_of('Alice')),
    ('00000000-0000-4000-8000-0000000000c4', tile_of('Alice', 1), member_of('Alice')),
    ('00000000-0000-4000-8000-0000000000c5', tile_of('Alice', 1), member_of('Alice'))
  on conflict (id) do nothing
$$, 'a queue of three taps syncs');

select lives_ok($$
  insert into increments (id, tile_id, member_id) values
    ('00000000-0000-4000-8000-0000000000c3', tile_of('Alice', 1), member_of('Alice')),
    ('00000000-0000-4000-8000-0000000000c4', tile_of('Alice', 1), member_of('Alice')),
    ('00000000-0000-4000-8000-0000000000c5', tile_of('Alice', 1), member_of('Alice'))
  on conflict (id) do nothing
$$, 'and re-running the sync is accepted again');

select is(progress_of('Alice', 1), 3,
  'exactly 3 Increments exist — no conflict resolution needed anywhere (§17.4)');

-- ---------------------------------------------------------------------------------
-- §11.3 — append-only. Deleting is the only mutation there is
-- ---------------------------------------------------------------------------------

select throws_ok($$
  update increments set note = 'actually it was two walks'
   where id = '00000000-0000-4000-8000-0000000000c1'
$$, '42501', null,
  'an Increment cannot be edited — there is no UPDATE grant, by design (§11.3)');

select lives_ok($$
  delete from increments where id = '00000000-0000-4000-8000-0000000000c2'
$$, 'a mistake is corrected by deleting it, which is the only mutation permitted');

select is(progress_of('Alice', 0), 1, 'and progress follows the log back down');

-- ---------------------------------------------------------------------------------
-- §12.1 — a Tile with no Goal has no Target, so it cannot take progress
-- ---------------------------------------------------------------------------------
--
-- Not a hypothetical tidiness rule. §18.6 carries Increments over to a swapped-in Goal,
-- so an empty Tile that accepted taps would let a Member bank ninety of them in
-- November and then spend one Swap writing a Goal those taps already complete — the
-- manufactured Bingo §18.5 exists to prevent.

select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c6', tile_of('Alice', 2), member_of('Alice'))
$$, '42501', null,
  'an empty Tile cannot be tapped — there is no Target to make progress toward');

select is(
  (select count(*) from tiles t where t.id = tile_of('Alice', 2) and t.goal_id is null)::int,
  1, 'and the Tile is genuinely empty, which is a normal sealed state (§10.2)');

-- ---------------------------------------------------------------------------------
-- §9.5 — the personal Center Tile is a Tile like any other once written
-- ---------------------------------------------------------------------------------

select is((select center_mode from years
            where family_id = (select id from families where name = 'Hertzell Family')),
  'personal', 'this Family''s centre resolved to personal (§8.3)');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c7', tile_of('Alice', 12), member_of('Alice'))
$$, 'a personal Center Tile takes Increments like any other Tile (§9.5)');

-- ---------------------------------------------------------------------------------
-- §12.3 — the shared Center Tile is marked done, not counted up
-- ---------------------------------------------------------------------------------
--
-- A Family Goal has no Target: any Member marks it and it completes for everyone at
-- once. Counting taps against it would be progress toward a number that does not exist.

-- Carol founds it, not Alice: switching to the `postgres` role leaves the JWT claims
-- untouched, so create_family() would have enrolled whoever acted last and made
-- member_of('Alice') two rows.
select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');

select set_config('role', 'postgres', true);
insert into members (family_id, guardian_account_id, display_name, role, status)
  values ((select id from families where name = 'Okonkwo Family'),
          '00000000-0000-4000-8000-0000000000a3', 'Chidi', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a3');
select open_year((select id from families where name = 'Okonkwo Family'), 2028);
select set_config('role', 'postgres', true);

insert into proposals (id, vote_id, member_id, text)
  select '00000000-0000-4000-8000-0000000000d1', v.id, member_of('Chidi'),
         'Walk the Ridgeway together'
    from votes v join years y on y.id = v.year_id
   where y.family_id = (select id from families where name = 'Okonkwo Family')
     and v.kind = 'goal';
insert into ballots (vote_id, member_id, choice_mode)
  select v.id, member_of('Chidi'), 'shared'
    from votes v join years y on y.id = v.year_id
   where y.family_id = (select id from families where name = 'Okonkwo Family')
     and v.kind = 'mode';
insert into ballots (vote_id, member_id, proposal_id)
  select v.id, member_of('Chidi'), '00000000-0000-4000-8000-0000000000d1'
    from votes v join years y on y.id = v.year_id
   where y.family_id = (select id from families where name = 'Okonkwo Family')
     and v.kind = 'goal';

update years set setup_deadline = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Okonkwo Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id in (select id from years
                    where family_id = (select id from families where name = 'Okonkwo Family'));

select act_as_cron();
select is(seal_due_boards(), 2, 'the shared-mode Family seals too — Carol''s Board and Chidi''s');

select set_config('role', 'postgres', true);
select isnt((select t.family_goal_id from tiles t where t.id = tile_of('Chidi', 12)), null,
  'and Chidi''s Tile 12 carries the Family Goal (§9.4)');

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000d2', tile_of('Chidi', 12), member_of('Chidi'))
$$, '42501', null,
  'a shared Center Tile cannot be tapped — a Family Goal is marked done, not counted (§12.3)');

-- ---------------------------------------------------------------------------------
-- §11.5 — a Member does not get to choose when their tap happened
-- ---------------------------------------------------------------------------------
--
-- occurred_at is genuinely the client's to state, because the offline queue replays
-- taps days after they happened (§17.3) and that is what the column is for. The two
-- ends of the range are not symmetrical. A clock running fast is benign and its tap is
-- kept; a tap claiming to predate the Board it belongs to has no honest cause and is
-- refused.

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$
  insert into increments (id, tile_id, member_id, occurred_at)
  values ('00000000-0000-4000-8000-0000000000c8', tile_of('Alice', 0), member_of('Alice'),
          now() - interval '5 days')
$$, 'a tap logged offline last week keeps the day it happened (§17.3)');

select is(
  (select i.occurred_at from increments i where i.id = '00000000-0000-4000-8000-0000000000c8'),
  now() - interval '5 days',
  'exactly — an honest offline tap must not be flattened into today');

-- The instant of the seal itself is inside the window, not outside it. Off-by-one here
-- would refuse the first tap of every Year.
select lives_ok($$
  insert into increments (id, tile_id, member_id, occurred_at)
  select '00000000-0000-4000-8000-0000000000cb', tile_of('Alice', 0), member_of('Alice'),
         b.sealed_at from boards b where b.member_id = member_of('Alice')
$$, 'a tap at the very instant of the seal is inside the window');

-- Before the Board was even sealed. No offline queue can hold a tap from before the
-- Board existed, so this is a client bug or a lie — and Wrapped aggregates by month and
-- hands out "biggest month" and "most consistent" (§20.4), which is what an unbounded
-- occurred_at would quietly be writing.
select throws_ok($$
  insert into increments (id, tile_id, member_id, occurred_at)
  values ('00000000-0000-4000-8000-0000000000c9', tile_of('Alice', 0), member_of('Alice'),
          now() - interval '200 days')
$$, 'PT403', null,
  'a tap claiming to predate the seal is refused — there is no backdating (§11.5)');

select lives_ok($$
  insert into increments (id, tile_id, member_id, occurred_at, created_at)
  values ('00000000-0000-4000-8000-0000000000ca', tile_of('Alice', 0), member_of('Alice'),
          now() + interval '10 days', now() + interval '10 days')
$$, 'and a tap from a device whose clock runs fast is not thrown away either');

select is(
  (select i.occurred_at from increments i where i.id = '00000000-0000-4000-8000-0000000000ca'),
  now(), 'it is pulled back to now — nothing has happened in the future');

select is(
  (select i.created_at from increments i where i.id = '00000000-0000-4000-8000-0000000000ca'),
  now(),
  'and created_at is the server''s alone: the Feed is ordered by it, so a client that '
  'could set it could pin itself to the top of the Family''s Feed forever');

select * from finish();
rollback;
