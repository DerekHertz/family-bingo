-- Slice 18, server half: Swaps.
--
-- Acceptance test (PRD §18):
--   Given a Member with a sealed Board and 3 Swaps remaining
--   When they replace a Goal
--   Then a Revision records the before and after, the Feed shows the Swap to the Family,
--   and 2 Swaps remain
--   And when a Member with 0 Swaps remaining attempts one
--   Then it is rejected
--
-- costOfRewrite() and evaluateGoalRewrite() are unit-tested exhaustively in
-- src/domain/swaps.test.ts. What is checked here is the transcription, the budget the
-- database enforces on its own (§18.1), and the two consequences a pure function has no
-- way to have: the Revision, and what a lowered Target does to a Board mid-Year.

begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

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

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

create or replace function swaps_used_by(name text) returns int
language sql stable as $$
  select b.swaps_used from boards b where b.member_id = member_of(name)
$$;

create or replace function goal_on(name text, pos int) returns goals
language sql stable as $$
  select g.* from goals g join tiles t on t.goal_id = g.id where t.id = tile_of(name, pos)
$$;

create or replace function revisions_for(name text) returns int
language sql stable as $$
  select count(*)::int from revisions r join boards b on b.id = r.board_id
   where b.member_id = member_of(name)
$$;

create or replace function tap(name text, pos int, id uuid) returns void
language sql as $$
  insert into increments (id, tile_id, member_id) values (id, tile_of(name, pos), member_of(name))
  on conflict (id) do nothing
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a4', 'dele@example.test',  '{"full_name":"Dele"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year(family_named('Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 144, 'walks');
select write_goal(tile_of('Alice', 1), 'Read a book', 12, 'books');
select write_goal(tile_of('Alice', 2), 'Swim', 20, 'swims');
select write_goal(tile_of('Alice', 3), 'Cook something new', 30, 'meals');
select write_goal(tile_of('Alice', 4), 'Call Mum', 52, 'calls');
-- Tile 5 is deliberately left empty: an unfinished Board seals with empty Tiles (§10.2).

-- ---------------------------------------------------------------------------------
-- Before the seal, everything is free editing
-- ---------------------------------------------------------------------------------

select throws_ok(
  $$select swap_tile(tile_of('Alice', 0), 'Walk the dog twice', 200)$$,
  'PT403', null,
  'a draft Board is not a commitment, so there is nothing to swap yet (§6.4)');

select is(swaps_used_by('Alice'), 0, 'and no budget has been touched');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = family_named('Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = (select id from years where family_id = family_named('Hertzell Family'));

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
-- "A Tile that sealed empty", which after the deal is no longer a fixed square (§10.2).
create or replace function tile_empty(name text) returns uuid
language sql stable as $empty$
  select t.id from tiles t
    join boards b on b.id = t.board_id
   where b.member_id = member_of(name)
     and t.goal_id is null and t.family_goal_id is null and t.position <> 12
   order by t.position
   limit 1
$empty$;

create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $dealt$
  select coalesce(
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
       join goals  g on g.id = t.goal_id
      where b.member_id = member_of(name)
        and g.text = (select m.txt from (values
                ('Alice', 0, 'Walk the dog'),
                ('Alice', 1, 'Read a book'),
                ('Alice', 2, 'Swim'),
                ('Alice', 3, 'Cook something new'),
                ('Alice', 4, 'Call Mum'),
                ('Alice', 5, 'Something easy'),
                ('Carol', 0, 'Run a marathon')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

select is(seal_due_boards(), 2, 'both Boards seal — everything after this costs a Swap');

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c2');

select lives_ok(
  $$select swap_tile(tile_of('Alice', 0), 'Walk the dog every day', 144)$$,
  'a Member with three Swaps remaining replaces a Goal');

select is(swaps_used_by('Alice'), 1, 'and two Swaps remain');
select is(revisions_for('Alice'), 1, 'a Revision records it (§18.4)');

select is((select r.before_text from revisions r limit 1), 'Walk the dog',
  'what the Tile said before');
select is((select r.after_text from revisions r limit 1), 'Walk the dog every day',
  'and what it says now — this is what makes a Bingo checkable (CONTEXT.md, Revision)');
select is((select r.before_target from revisions r limit 1), 144, 'with the Target before');
select is((select r.after_target from revisions r limit 1), 144, 'and after');

-- §18.4: every Swap is shown to the Family. The visibility is half the enforcement.
select is((select count(*)::int from feed f where f.kind = 'swap'), 1,
  'and the Family sees it in the Feed (§18.4)');
select is((select f.member_id from feed f where f.kind = 'swap'), member_of('Alice'),
  'attributed to the Member who spent it');

-- §18.6: progress carries over. It hangs off the Tile, not the Goal.
-- By the Goal the Swap put there, not the one it replaced: tile_of() follows the Goal
-- text, and after a Swap the old text is on no Tile at all. The Tile is the same Tile —
-- which is the whole point of §18.6.
select is((select count(*)::int from increments i
             join tiles t on t.id = i.tile_id
             join goals g on g.id = t.goal_id
            where g.text = 'Walk the dog every day'), 2,
  'the two Increments logged against the old Goal are untouched (§18.6)');

-- ---------------------------------------------------------------------------------
-- §18.3 — raising a Target is free
-- ---------------------------------------------------------------------------------
--
-- Making a Goal harder needs no policing, so it costs nothing and writes no Revision.
-- A Revision is what spends the budget; recording one here would quietly charge for it.

select lives_ok(
  $$select swap_tile(tile_of('Alice', 1), 'Read a book', 24)$$,
  'a Member doubles a Target');
select is((select target from goal_on('Alice', 1)), 24, 'the Target rises');
select is(swaps_used_by('Alice'), 1, 'and it costs nothing (§18.3)');
select is(revisions_for('Alice'), 1, 'writing no Revision, because it is not a Swap');

-- Rewriting nothing costs nothing either.
select lives_ok(
  $$select swap_tile(tile_of('Alice', 1), 'Read a book', 24)$$,
  'and saying the same thing twice is a no-op');
select is(swaps_used_by('Alice'), 1, 'still one Swap spent');

-- ---------------------------------------------------------------------------------
-- §18.2 — lowering a Target is a Swap, and it is the one §18.5 is about
-- ---------------------------------------------------------------------------------

select lives_ok(
  $$select swap_tile(tile_of('Alice', 2), 'Swim', 10)$$,
  'a Member halves a Target');
select is(swaps_used_by('Alice'), 2, 'which costs a Swap (§18.2)');
select is(revisions_for('Alice'), 2, 'and is recorded for the Family to see');

-- ---------------------------------------------------------------------------------
-- §18.5 — filling an empty Tile on a sealed Board
-- ---------------------------------------------------------------------------------
--
-- The Tile was left empty by the Member's own choice. Filling it in December against a
-- Line they are one short of is the manufactured Bingo by another route.

select is((select goal_id from tiles where id = tile_empty('Alice')), null,
  'a Tile sealed empty (§10.2)');

select throws_ok(
  $$select write_goal(tile_empty('Alice'), 'Something easy', 1)$$,
  'PT403', null,
  'write_goal will not fill it — that door closed at the seal');

select lives_ok(
  $$select swap_tile(tile_of('Alice', 5), 'Learn to juggle', 1)$$,
  'swap_tile will, at the price of a Swap (§18.5)');
select is(swaps_used_by('Alice'), 3, 'the third and last');
select is((select before_text from revisions r
            where r.tile_id = tile_of('Alice', 5)), null,
  'the Revision records that there was nothing there before');

-- ---------------------------------------------------------------------------------
-- §18.1 — three per Member per Year, enforced in the database
-- ---------------------------------------------------------------------------------

select throws_ok(
  $$select swap_tile(tile_of('Alice', 3), 'Cook something else', 30)$$,
  'PT403', null,
  'a Member with 0 Swaps remaining is rejected (§18.1)');

select is(swaps_used_by('Alice'), 3, 'and the budget is not overspent');
select is((select text from goal_on('Alice', 3)), 'Cook something new',
  'the Goal is untouched');

-- Raising a Target is still free with an exhausted budget — it was never a Swap.
select lives_ok(
  $$select swap_tile(tile_of('Alice', 4), 'Call Mum', 104)$$,
  'but making a Goal harder is still free at zero remaining (§18.3)');
select is((select target from goal_on('Alice', 4)), 104, 'and it takes effect');

-- The CHECK is the enforcement of last resort, underneath the RPC's own error. Reached as
-- postgres, because `authenticated` has no UPDATE grant on boards at all — the RPC is the
-- only door, and this is what is behind it if one is ever added.
select act_as_cron();
select throws_ok($$
  update boards set swaps_used = 4 where swaps_used = 3
$$, '23514', null, 'and a fourth Swap cannot be written by any route (§8.2)');

-- ---------------------------------------------------------------------------------
-- A lowered Target that lands under the progress already logged
-- ---------------------------------------------------------------------------------
--
-- 100 Increments against a Target moved from 144 to 90 completes the Tile the instant the
-- Swap commits, and there is no Increment to notice it. Completion Milestones are emitted
-- by the Increment trigger (§12), so without help a Member could close a Line — and a
-- Bingo — in silence. They paid a Swap and the Family can see the Revision; what they do
-- not get is quiet.

select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');

-- Dele exists so there is somebody to tell, and has an Account of his own rather than
-- being one of Carol's Managed Members. §15.5 excludes the ACCOUNT behind the Member who
-- caused a Milestone, so a child played through Carol's login would be excluded with her
-- and the assertion below would pass for the wrong reason.
select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Okonkwo Family'), '00000000-0000-4000-8000-0000000000a4', 'Dele', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a3');
select open_year(family_named('Okonkwo Family'), 2027);
select write_goal(tile_of('Carol', 0), 'Run a marathon', 144, 'runs');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where id = (select id from years where family_id = family_named('Okonkwo Family'));
update votes set closes_at = now() - interval '1 minute'
 where year_id = (select id from years where family_id = family_named('Okonkwo Family'));

select act_as_cron();
select is(seal_due_boards(), 2, 'the Okonkwo Boards seal');
delete from notifications;

select act_as('00000000-0000-4000-8000-0000000000a3');
do $$
begin
  for i in 1..100 loop
    perform tap('Carol', 0, gen_random_uuid());
  end loop;
end;
$$;

select is((select count(*)::int from increments where tile_id = tile_of('Carol', 0)), 100,
  'Carol logs 100 of 144 runs');
select is((select count(*)::int from milestones m where m.member_id = member_of('Carol')), 0,
  'and the Tile is not complete');

select lives_ok(
  $$select swap_tile(tile_of('Carol', 0), 'Run a marathon', 90)$$,
  'she spends a Swap to move the Target under what she has already done');

select is((select count(*)::int from milestones m
            where m.member_id = member_of('Carol') and m.type = 'tile_completed'), 1,
  'the Tile completes, and says so — a Swap does not buy silence (§18.5)');

select act_as_cron();
select is((select count(*)::int from notifications n where n.kind = 'tile_completed'), 1,
  'the Family is told, exactly as if an Increment had done it');

select act_as('00000000-0000-4000-8000-0000000000a3');
select is((select count(*)::int from feed f where f.kind = 'swap'
            and f.member_id = member_of('Carol')), 1,
  'and the Revision sits beside it in the Feed, showing what she changed');

-- ---------------------------------------------------------------------------------
-- What cannot be swapped at any price
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a3');
select tap('Carol', 0, '00000000-0000-4000-8000-0000000000e1');
select throws_ok(
  $$select swap_tile(tile_of('Carol', 0), 'Run two marathons', 200)$$,
  'PT403', null,
  'a completed Tile is finished — rewriting it would rewrite a Milestone already pushed');

-- The shared Center Tile is one row on every Board (§9.4), not one Member's to rewrite.
select act_as('00000000-0000-4000-8000-0000000000a2');
select set_config('role', 'postgres', true);
insert into family_goals (id, year_id, text)
  select '00000000-0000-4000-8000-0000000000fa',
         (select id from years where family_id = family_named('Hertzell Family')),
         'Walk the Ridgeway together';
update tiles set family_goal_id = '00000000-0000-4000-8000-0000000000fa'
 where id = tile_of('Bob', 12);

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select swap_tile(tile_of('Bob', 12), 'Something I would rather do', 1)$$,
  'PT403', null,
  'the shared Center Tile belongs to the Family, not to one Member (§9.4)');

-- CROSS-FAMILY and SELF-ONLY, as everywhere.
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select swap_tile(tile_of('Carol', 1), 'Not mine to change', 5)$$,
  '42501', null,
  'CROSS-FAMILY: alice cannot swap a Tile on another Family''s Board');

select throws_ok(
  $$select swap_tile(tile_of('Bob', 0), 'Not mine either', 5)$$,
  '42501', null,
  'SELF-ONLY: nor one in her own Family that is not hers');

-- A frozen Year refuses everything, before any of the rest is worth asking (§20.1).
select set_config('role', 'postgres', true);
update years set frozen_at = now(), status = 'frozen'
 where family_id = family_named('Okonkwo Family');

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select swap_tile(tile_of('Carol', 1), 'Too late', 5)$$,
  '42501', null,
  'and a frozen Year is permanent family history (§20.1)');

select * from finish();
rollback;
