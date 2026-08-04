-- Slice 6, server half: write a Goal.
--
-- The acceptance test (PRD §6):
--   Given a Member with a draft Board
--   When they type "Read more books" into Tile 3 and set a target of 12 books
--   Then Tile 3 holds that Goal with target = 12 and unit = 'books', and it persists
--   across an app restart

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function tile_at(pos int, member_name text) returns uuid
language sql stable as $$
  select t.id from tiles t
    join boards b on b.id = t.board_id
    join members m on m.id = b.member_id
   where t.position = pos and m.display_name = member_name;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test', '{"full_name":"Bob"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');
select create_managed_member((select id from families limit 1), 'Theo');
select open_year((select id from families limit 1), 2027);

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------

select lives_ok($$
  select write_goal(tile_at(3, 'Alice'), 'Read more books', 12, 'books')
$$, 'a Member writes a Goal into Tile 3');

select is((select g.text from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(3, 'Alice')), 'Read more books',
  'Tile 3 holds that Goal');
select is((select g.target from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(3, 'Alice')), 12, 'with target 12');
select is((select g.unit from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(3, 'Alice')), 'books', 'and unit books');

-- §6.1a: the two Wrapped-only fields stay NULL for a Goal that skipped Sharpening,
-- and that Goal still counts everywhere except aggregate Wrapped cards (§20.8).
select is((select g.unit_canonical from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(3, 'Alice')), null,
  'unit_canonical is NULL — it is inferred by Sharpening, never typed (§6.1a)');
select is((select g.category from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(3, 'Alice')), null,
  'and so is category');

-- ---------------------------------------------------------------------------------
-- §6.2 — target = 1 IS the one-shot shape
-- ---------------------------------------------------------------------------------

select lives_ok($$select write_goal(tile_at(0, 'Alice'), 'Run a marathon', 1)$$,
  'a one-shot Goal is just target = 1 — no type column, no second code path (§6.2)');
select is((select g.target from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(0, 'Alice')), 1, 'stored as 1');
select throws_ok($$select write_goal(tile_at(1, 'Alice'), 'Impossible', 0)$$,
  '22023', null, 'a Target of 0 is rejected');
select throws_ok($$select write_goal(tile_at(1, 'Alice'), 'Impossible', -3)$$,
  '22023', null, 'and so is a negative one');

-- ---------------------------------------------------------------------------------
-- Sharpening's two fields, when they ARE supplied
-- ---------------------------------------------------------------------------------

select lives_ok($$
  select write_goal(tile_at(4, 'Alice'), 'Walk 300 times', 300,
                    'Walks', 'Walk', 'fitness', 'about 6 a week')
$$, 'a sharpened Goal carries unit_canonical, category and pace_hint');
select is((select g.unit_canonical from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(4, 'Alice')), 'walk',
  'unit_canonical is normalised to singular lowercase, so one Member''s "Books" and '
  'another''s "book" add up at year end (§7.10)');
select is((select g.unit from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(4, 'Alice')), 'Walks',
  'while the Member''s own wording is kept exactly as they wrote it');
select is((select g.pace_hint from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(4, 'Alice')), 'about 6 a week',
  'pace_hint is stored — display only, and nothing may ever branch on it (§6.3)');
select throws_ok($$
  select write_goal(tile_at(5, 'Alice'), 'Vibes', 1, null, null, 'vibes')
$$, '23514', null, 'an unknown Category is refused by the schema''s closed set');

-- ---------------------------------------------------------------------------------
-- §6.4 — free editing while the Board is a draft
-- ---------------------------------------------------------------------------------

select lives_ok($$
  select write_goal(tile_at(3, 'Alice'), 'Read 20 books instead', 20, 'books')
$$, 'a draft Tile can be rewritten freely (§6.4)');
select is((select g.text from tiles t join goals g on g.id = t.goal_id
            where t.id = tile_at(3, 'Alice')), 'Read 20 books instead',
  'and holds the new Goal');
select is((select count(*) from goals)::int, 3,
  'rewriting updates in place rather than orphaning the old Goal row — still 3 Goals '
  'for 3 filled Tiles, not 4');

select lives_ok($$select clear_goal(tile_at(0, 'Alice'))$$,
  'a draft Tile can be emptied again — an unfinished Board seals with empty Tiles (§10.2)');
select is((select goal_id from tiles where id = tile_at(0, 'Alice')), null,
  'leaving the Tile empty');
select is((select count(*) from goals)::int, 2, 'and no Goal left behind');

-- ---------------------------------------------------------------------------------
-- §6.5 — the Center Tile is not authored like the others
-- ---------------------------------------------------------------------------------

select throws_ok($$select write_goal(tile_at(12, 'Alice'), 'My own centre', 1)$$,
  'PT403', null,
  'the Center Tile cannot be authored while the mode is undecided (§6.5)');

select set_config('role', 'postgres', true);
update years set center_mode = 'shared';
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$select write_goal(tile_at(12, 'Alice'), 'My own centre', 1)$$,
  'PT403', null,
  'nor when the Family voted shared — it belongs to the Family, not the Member');

select set_config('role', 'postgres', true);
update years set center_mode = 'personal';
select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select write_goal(tile_at(12, 'Alice'), 'My own centre', 1)$$,
  'but once the vote resolves to personal, each Member fills it like any other Tile (§9.5)');

-- ---------------------------------------------------------------------------------
-- Whose Board it is
-- ---------------------------------------------------------------------------------

select lives_ok($$select write_goal(tile_at(7, 'Theo'), 'Learn to swim', 10, 'lengths')$$,
  'a Guardian authors on behalf of their Managed Member (§4.2)');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok($$select write_goal(tile_at(8, 'Alice'), 'Not mine', 1)$$,
  '42501', null, 'CROSS-FAMILY: an outsider cannot write onto someone else''s Board');
select throws_ok($$select write_goal(tile_at(8, 'Theo'), 'Not mine either', 1)$$,
  '42501', null, 'CROSS-FAMILY: nor onto a Managed Member''s');

-- ---------------------------------------------------------------------------------
-- sharpened_at — the Goal's one sharpen (FRONTEND_DESIGN §4.2, migration 33)
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

select is((select sharpened_at from write_goal(tile_at(20, 'Alice'), 'Unsharpened', 1)),
  null, 'a Goal written without Sharpening carries no stamp');

select isnt((select sharpened_at from
    write_goal(tile_at(21, 'Alice'), 'Walk', 300, 'walks', 'walk', 'fitness',
               'about six a week', true)),
  null, 'a Goal written after a successful Sharpening is stamped');

-- The reason this is a column and not an inference: BOTH of these leave `category` null,
-- and the client used to read a null category as "never sharpened" and offer another.
select isnt((select sharpened_at from
    write_goal(tile_at(22, 'Alice'), 'Kept my own words', 1, null, null, null, null, true)),
  null, 'stamped even when the Member kept their own words and no category came back');

-- The stamp survives editing, which §4.2 explicitly invites ("both cards stay editable by
-- hand afterwards"). Handing the sharpen back on an edit is the slot machine returning.
select isnt((select sharpened_at from
    write_goal(tile_at(21, 'Alice'), 'Walk the dog', 150, 'walks')),
  null, 'editing a sharpened Goal by hand does NOT hand its sharpen back');

select is(
  (select sharpened_at from write_goal(tile_at(20, 'Alice'), 'Still unsharpened', 2)),
  null, 'and an ordinary edit of an unsharpened Goal does not invent one');

-- Clearing the Tile deletes the Goal, so a genuinely new Goal starts unstamped.
select clear_goal(tile_at(21, 'Alice'));
select is((select sharpened_at from write_goal(tile_at(21, 'Alice'), 'A new goal', 1)),
  null, 'a Goal written into a cleared Tile starts fresh');

-- ---------------------------------------------------------------------------------
-- After Sealing, and after Freeze
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
update boards set sealed_at = now();
select act_as('00000000-0000-4000-8000-0000000000a1');

select throws_ok($$select write_goal(tile_at(9, 'Alice'), 'Too late', 1)$$,
  'PT403', null,
  'SEALED: Goal text and Target are immutable except through a Swap (§10.3)');
select throws_ok($$select clear_goal(tile_at(3, 'Alice'))$$,
  'PT403', null, 'SEALED: and a Tile cannot be emptied either');

select set_config('role', 'postgres', true);
update years set frozen_at = now(), status = 'frozen';
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$select write_goal(tile_at(9, 'Alice'), 'Far too late', 1)$$,
  '42501', null, 'FROZEN: a frozen Year is permanently read-only (§20.1)');

select * from finish();
rollback;
