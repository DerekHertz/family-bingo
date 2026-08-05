-- Slice 13, server half: Lines, Bingo and Blackout.
--
-- Acceptance test (PRD §13):
--   Given a Board with Tiles 0, 1, 2, 3 complete
--   When Tile 4 completes
--   Then a Line is recorded for row 0, a `bingo` Milestone fires (it is the Member's
--   first Line), and the Board shows 1 of 12 Lines
--
-- The pure logic is unit-tested exhaustively in src/domain/lines.test.ts (§13.6). What
-- this file checks is the transcription: that the database's twelve Lines are the same
-- twelve, in the same order, and that the Milestones it records are the ones
-- milestonesToEmit() would have derived.

begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

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

-- ---------------------------------------------------------------------------------
-- A Board is laid out by board_positions(), derived from its own id (§4.1)
-- ---------------------------------------------------------------------------------
--
-- "positions are dealt at seal, so no Member can place the easy one in a corner." So
-- after the seal the Goal written to square N is no longer on square N, and every
-- assertion below that says `tile_of(name, N)` means "the Tile carrying the Goal I wrote
-- to N" — which is exactly what dealt_position() answers. Before the seal the two are the
-- same thing, which is why this works on both sides of it.
create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $dealt$
  select t.id
    from tiles t
    join boards b on b.id = t.board_id
   where b.member_id = member_of(name)
     and t.position = case
           when b.sealed_at is null then pos
           else dealt_position(b.id, pos)
         end
$dealt$;

-- The literal square, for the assertions that mean one. A Line is five squares (§13.1),
-- whichever Goals the layout put on them.
create or replace function tile_at(name text, pos int) returns uuid
language sql stable as $at$
  select t.id from tiles t
    join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$at$;

-- Complete whatever Goal sits on a square, by logging its own Target.
create or replace function finish_at(name text, pos int) returns void
language plpgsql as $fin$
declare n int; tgt int;
begin
  select g.target into tgt
    from tiles t join goals g on g.id = t.goal_id
   where t.id = tile_at(name, pos);
  for n in 1..coalesce(tgt, 0) loop
    insert into increments (id, tile_id, member_id)
    values (gen_random_uuid(), tile_at(name, pos), member_of(name));
  end loop;
end;
$fin$;


create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

-- Lines a Member has closed, of either kind. This is the "1 of 12" the Board shows.
create or replace function lines_of(name text) returns int
language sql stable as $$
  select count(*)::int from milestones m
   where m.member_id = member_of(name) and m.type in ('bingo', 'line_completed')
$$;

create or replace function bingos_of(name text) returns int
language sql stable as $$
  select count(*)::int from milestones m
   where m.member_id = member_of(name) and m.type = 'bingo'
$$;

create or replace function blackouts_of(name text) returns int
language sql stable as $$
  select count(*)::int from milestones m
   where m.member_id = member_of(name) and m.type = 'blackout'
$$;

create or replace function tiles_done_of(name text) returns int
language sql stable as $$
  select count(*)::int from milestones m
   where m.member_id = member_of(name) and m.type = 'tile_completed'
$$;

-- Which kind of Milestone a given Line earned, or null if it has not closed.
create or replace function line_kind(name text, idx int) returns text
language sql stable as $$
  select m.type from milestones m
   where m.member_id = member_of(name) and m.line_index = idx
     and m.type in ('bingo', 'line_completed')
$$;

create or replace function author_positions(name text, ps int[], tgt int) returns void
language plpgsql as $$
declare p int;
begin
  foreach p in array ps loop
    perform write_goal(tile_of(name, p), 'Goal ' || p, tgt);
  end loop;
end;
$$;

-- Log exactly as many Increments as the Tile's Target, the way the client would
-- (api.md §8). Client-generated ids (§11.2), one per tap.
--
-- **By square, not by Goal.** A Line is five squares (§13.1) and closing one means
-- finishing whatever Goals the layout put on them — which is what a Member actually does.
-- Once a Board is dealt (§4.1) those are no longer the Goals that were written there.
create or replace function finish_positions(name text, ps int[]) returns void
language plpgsql as $$
declare
  p   int;
  n   int;
  tgt int;
begin
  foreach p in array ps loop
    select g.target into tgt
      from tiles t join goals g on g.id = t.goal_id
     where t.id = tile_at(name, p);
    for n in 1..tgt loop
      insert into increments (id, tile_id, member_id)
      values (gen_random_uuid(), tile_at(name, p), member_of(name));
    end loop;
  end loop;
end;
$$;

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

-- Everything but the centre: §6.5 keeps position 12 out of authoring until the Center
-- Vote resolves. Target 3 on Tile 0 so that the count path, not just the target-1
-- shortcut, is what carries the acceptance test.
select author_positions('Alice', array[0], 3);
select author_positions('Alice',
  array[1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22,23,24], 1);

-- Bob authors every square, not just the row he is going to finish.
--
-- The squares are dealt at seal (§4.1), so "write five Goals to positions 0-4" no longer
-- puts five Goals on row 0 — it puts them wherever the deal sends them, and a Line drawn
-- through empty Tiles can never close. Authoring the whole Board is what makes a
-- *positional* assertion meaningful once the mapping from write order to square is gone,
-- and it is what a Member who finishes a row will actually have done.
select act_as('00000000-0000-4000-8000-0000000000a2');
select author_positions('Bob',
  array[0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22,23,24], 1);

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Hertzell Family');

select act_as_cron();
select is(seal_due_boards(), 2, 'both Boards seal and the Year is under way');

-- Nobody cast a Ballot, so the mode falls back to personal (§8.3) and each Member
-- authors their own centre in the seven days after the seal (§9.5).
select act_as('00000000-0000-4000-8000-0000000000a1');
select author_positions('Alice', array[12], 1);

-- ---------------------------------------------------------------------------------
-- §13.1 — the twelve Lines, enumerated as constants
-- ---------------------------------------------------------------------------------
--
-- Not computed from the row-major indexing, and in the order milestones.line_index
-- refers to. These assertions are the contract between board_lines() and LINES in
-- src/domain/lines.ts; if either side is renumbered the other has to move with it.
--
-- Read as the database itself, because board_lines() is revoked from `authenticated` —
-- a client never asks the server where the Lines are, it has the same constants.
select act_as_cron();

select is((select count(*)::int from board_lines()), 12,
  'twelve Lines: five rows, five columns, two diagonals (§13.1)');

-- All twelve, individually, so that a failure names the Line that moved. Cardinality and
-- coverage checks are not enough on their own: swapping two Lines of the same shape
-- leaves both intact and would go unnoticed, and a swap is exactly how two hand-kept
-- copies drift.
select is((select positions from board_lines() where line_index = 0),
  array[0,1,2,3,4], 'Line 0 is row 0');
select is((select positions from board_lines() where line_index = 1),
  array[5,6,7,8,9], 'Line 1 is row 1');
select is((select positions from board_lines() where line_index = 2),
  array[10,11,12,13,14], 'Line 2 is row 2, through the centre');
select is((select positions from board_lines() where line_index = 3),
  array[15,16,17,18,19], 'Line 3 is row 3');
select is((select positions from board_lines() where line_index = 4),
  array[20,21,22,23,24], 'Line 4 is row 4');
select is((select positions from board_lines() where line_index = 5),
  array[0,5,10,15,20], 'Line 5 is column 0');
select is((select positions from board_lines() where line_index = 6),
  array[1,6,11,16,21], 'Line 6 is column 1');
select is((select positions from board_lines() where line_index = 7),
  array[2,7,12,17,22], 'Line 7 is column 2, through the centre');
select is((select positions from board_lines() where line_index = 8),
  array[3,8,13,18,23], 'Line 8 is column 3');
select is((select positions from board_lines() where line_index = 9),
  array[4,9,14,19,24], 'Line 9 is column 4');
select is((select positions from board_lines() where line_index = 10),
  array[0,6,12,18,24], 'Line 10 is the down-right diagonal');
select is((select positions from board_lines() where line_index = 11),
  array[4,8,12,16,20], 'Line 11 is the down-left diagonal');

select is(
  (select count(*)::int from board_lines() l where 12 = any(l.positions)), 4,
  'the Center Tile sits on four Lines — row 2, column 2 and both diagonals');

select is(
  (select count(*)::int from generate_series(0, 24) p
    where not exists (select 1 from board_lines() l where p = any(l.positions))),
  0, 'and every one of the 25 positions is on at least one Line');

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select finish_positions('Alice', array[0,1,2,3]);

select is(tiles_done_of('Alice'), 4, 'four Tiles of row 0 are complete');
select is(lines_of('Alice'), 0, 'four of five closes nothing');
select is(blackouts_of('Alice'), 0, 'and is a long way from Blackout');

select finish_positions('Alice', array[4]);

select is(lines_of('Alice'), 1, 'the fifth Tile closes a Line — the Board shows 1 of 12');
select is(line_kind('Alice', 0), 'bingo',
  'row 0 is the Member''s first Line, so it is their Bingo (§13.2)');
select is(bingos_of('Alice'), 1, 'exactly one Bingo');

-- ---------------------------------------------------------------------------------
-- §13.2 — every later Line is the quieter one
-- ---------------------------------------------------------------------------------

-- Column 0 is Tiles 0, 5, 10, 15, 20. Tile 0 is already done.
select finish_positions('Alice', array[5,10,15,20]);

select is(lines_of('Alice'), 2, 'column 0 closes: 2 of 12');
select is(line_kind('Alice', 5), 'line_completed',
  'the second Line is a line_completed, not a second Bingo (§13.2)');
select is(bingos_of('Alice'), 1, 'a Member has at most one Bingo, ever');

-- §13.4: play continues after Bingo to the end of the Year. Nothing shuts off.
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values (gen_random_uuid(), tile_at('Alice', 0), member_of('Alice'))
$$, 'Increments keep landing after Bingo — it is a rung, not an ending (§13.4)');

select is(lines_of('Alice'), 2,
  'and logging past a closed Line records nothing further');

-- Derived, never stored (schema.md §3.1). Bingo state is the presence of a Milestone.
select hasnt_column('public', 'boards', 'has_bingo',
  'Bingo is the Milestone row, not a flag on the Board');
select hasnt_column('public', 'boards', 'lines_completed',
  'nor is the Line count cached');

-- ---------------------------------------------------------------------------------
-- §13.3 — Blackout
-- ---------------------------------------------------------------------------------

select finish_positions('Alice',
  array[6,7,8,9,11,12,13,14,16,17,18,19,21,22,23,24]);

select is(tiles_done_of('Alice'), 25, 'all 25 Tiles are complete');
select is(lines_of('Alice'), 12, 'all twelve Lines have closed');
select is(bingos_of('Alice'), 1, 'still exactly one Bingo among them');
select is(blackouts_of('Alice'), 1, 'and a Blackout, recorded once (§13.3)');

-- Idempotent: replaying an offline queue (§17.4) re-derives the same state and records
-- nothing a second time.
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values (gen_random_uuid(), tile_at('Alice', 24), member_of('Alice'))
$$, 'a Member keeps logging after Blackout');
select is(blackouts_of('Alice'), 1, 'no second Blackout');
select is(lines_of('Alice'), 12, 'and no thirteenth Line');

-- ---------------------------------------------------------------------------------
-- A Line closed by re-crossing, which records no new Tile Milestone
-- ---------------------------------------------------------------------------------
--
-- §11.3 lets a Member delete an Increment to correct a mistake, and §12.2 keeps the
-- tile_completed Milestone standing when they do — it was pushed to phones and cannot
-- be unsent. So a Tile can complete a second time while recording nothing. If Line
-- detection hung off that Milestone alone, the Line the second crossing closed would
-- never be found.

select act_as('00000000-0000-4000-8000-0000000000a2');
select finish_positions('Bob', array[0,1,2,3]);

select is(tiles_done_of('Bob'), 4, 'Bob completes four Tiles of row 0');

select lives_ok($$
  delete from increments where tile_id = tile_at('Bob', 0)
$$, 'then deletes the Increment on Tile 0, correcting a mistake (§11.3)');

select is(tiles_done_of('Bob'), 4,
  'the Milestone stands — the event happened and cannot be unsent (§12.2)');

select finish_positions('Bob', array[4]);
select is(lines_of('Bob'), 0,
  'but row 0 does not close, because Tile 0 is not complete (§12.1)');

select finish_positions('Bob', array[0]);
select is(tiles_done_of('Bob'), 5,
  're-crossing Tile 0 records no second Tile Milestone');
select is(lines_of('Bob'), 1, 'yet row 0 closes — the Line is found anyway');
select is(line_kind('Bob', 0), 'bingo', 'and it is Bob''s Bingo');

-- ---------------------------------------------------------------------------------
-- The shared Center Tile closes four Lines at once, for everyone
-- ---------------------------------------------------------------------------------
--
-- Tile 12 sits on row 2, column 2 and both diagonals. When the Family completes a shared
-- Family Goal, every Member's Board advances on those four Lines at the same moment —
-- which is the point of the shared centre (schema.md §5.4). Exactly one of the four is
-- the Bingo, and in constant order that is the lowest-numbered.

select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');

select set_config('role', 'postgres', true);
insert into members (family_id, guardian_account_id, display_name, role, status)
  values ((select id from families where name = 'Okonkwo Family'),
          '00000000-0000-4000-8000-0000000000a3', 'Chidi', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a3');
select open_year((select id from families where name = 'Okonkwo Family'), 2028);

-- Every Tile on the four Lines through the centre, and nothing else.
-- The whole Board again, for the reason above: the deal (§4.1) scatters whatever subset
-- is authored, and the sixteen squares this test then finishes are chosen for the *Lines*
-- they nearly close. A Line drawn through an empty Tile can never close, so leaving
-- squares unauthored made the assertion depend on where the shuffle happened to land.
select author_positions('Chidi',
  array[0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22,23,24], 1);

select set_config('role', 'postgres', true);
insert into proposals (id, vote_id, member_id, text)
  select '00000000-0000-4000-8000-0000000000d1', v.id, member_of('Chidi'),
         'Walk the Ridgeway together'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'goal';
insert into ballots (vote_id, member_id, choice_mode)
  select v.id, member_of('Chidi'), 'shared'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'mode';
insert into ballots (vote_id, member_id, proposal_id)
  select v.id, member_of('Chidi'), '00000000-0000-4000-8000-0000000000d1'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'goal';

update years set setup_deadline = now() - interval '1 minute'
 where id = year_of('Okonkwo Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Okonkwo Family');

select act_as_cron();
select is(seal_due_boards(), 2, 'the shared-mode Family seals, Family Goal on every Tile 12');

select act_as('00000000-0000-4000-8000-0000000000a3');
select finish_positions('Chidi', array[10,11,13,14, 2,7,17,22, 0,6,18,24, 4,8,16,20]);

select is(tiles_done_of('Chidi'), 16, 'sixteen Tiles complete, four Lines one Tile short');
select is(lines_of('Chidi'), 0, 'and not one of them has closed');

select lives_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Chidi'))$$,
  'the Family marks its Family Goal done (§12.3)');

select is(lines_of('Chidi'), 4,
  'the shared centre closes four Lines at once — row 2, column 2 and both diagonals');
select is(bingos_of('Chidi'), 1,
  'exactly one of the four is the Bingo, even though they closed together (§13.2)');
select is(line_kind('Chidi', 2), 'bingo',
  'and it is the lowest-numbered, so the Feed reads the same way every time');
select is(line_kind('Chidi', 7), 'line_completed', 'column 2 is the quieter kind');
select is(line_kind('Chidi', 10), 'line_completed', 'so is the down-right diagonal');
select is(line_kind('Chidi', 11), 'line_completed', 'and the down-left');
select is(blackouts_of('Chidi'), 0, 'nine Tiles short of Blackout, so no Blackout');

-- The same Family Goal, the same moment, a different Board. Carol's centre completes
-- too, but her Lines are her own and none of them close.
select is(tiles_done_of('Carol'), 1, 'Carol''s Tile 12 completes at the same instant');
select is(lines_of('Carol'), 0,
  'but a Line is a fact about one Board — hers stay open (ADR-0001)');

-- ---------------------------------------------------------------------------------
-- A Bingo is a social claim, so it must not be forgeable
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$
  insert into milestones (member_id, year_id, type, line_index)
  values (member_of('Alice'), year_of('Hertzell Family'), 'bingo', 3)
$$, '42501', null,
  'a client cannot write its own Bingo — there is no INSERT grant, by design');

select throws_ok($$select record_line_milestones(
  (select b.id from boards b where b.member_id = member_of('Alice')))$$,
  '42501', null,
  'nor call the recorder directly');

-- Nothing crosses a Family boundary (ADR-0004). Alice cannot read a Bingo of Chidi's.
select is(
  (select count(*)::int from milestones m where m.year_id = year_of('Okonkwo Family')),
  0, 'CROSS-FAMILY: alice sees none of the Okonkwo Family''s Milestones');

select * from finish();
rollback;
