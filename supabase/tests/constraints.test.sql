-- The data-model invariants (PRD §8.2, schema.md §3).
--
-- These are encoded as constraints rather than conventions because a rule that lives
-- only in application code is a rule that will eventually be violated by a background
-- job, a migration, or an agent.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000a1');
-- accounts rows are provisioned by the on_auth_user_created trigger (slice 1).
insert into families (id, name) values
  ('00000000-0000-4000-8000-0000000000f1', 'Hertzell Family');
insert into members (id, family_id, account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a1', 'Alice', 'organizer', 'active');
insert into years (id, family_id, calendar_year, setup_deadline) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
   2027, '2027-01-01T05:00:00Z');
insert into boards (id, member_id, year_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-0000000000d1');
insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b1', p from generate_series(0, 24) p;

-- A Member is EITHER a real Account OR guarded by one. Never both, never neither.
select throws_ok($$
  insert into members (family_id, display_name) values
    ('00000000-0000-4000-8000-0000000000f1', 'Nobody')
$$, '23514', null, 'a Member with neither an Account nor a Guardian is rejected');

select throws_ok($$
  insert into members (family_id, account_id, guardian_account_id, display_name) values
    ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1',
     '00000000-0000-4000-8000-0000000000a1', 'Both')
$$, '23514', null, 'a Member with both an Account and a Guardian is rejected');

-- One Board per Member per Year.
select throws_ok($$
  insert into boards (member_id, year_id) values
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1')
$$, '23505', null, 'a second Board for the same Member and Year is rejected');

-- One Year per Family per calendar year.
select throws_ok($$
  insert into years (family_id, calendar_year, setup_deadline) values
    ('00000000-0000-4000-8000-0000000000f1', 2027, '2027-01-01T05:00:00Z')
$$, '23505', null, 'a second Year for the same Family and calendar year is rejected');

-- Exactly 25 Tiles at positions 0-24, no duplicates.
select is((select count(*) from tiles where board_id = '00000000-0000-4000-8000-0000000000b1')::int,
  25, 'a Board carries exactly 25 Tiles');
select throws_ok($$
  insert into tiles (board_id, position) values ('00000000-0000-4000-8000-0000000000b1', 25)
$$, '23514', null, 'a Tile at position 25 is rejected');
select throws_ok($$
  insert into tiles (board_id, position) values ('00000000-0000-4000-8000-0000000000b1', -1)
$$, '23514', null, 'a Tile at a negative position is rejected');
select throws_ok($$
  insert into tiles (board_id, position) values ('00000000-0000-4000-8000-0000000000b1', 12)
$$, '23505', null, 'a duplicate Tile position is rejected');

-- Only the Center Tile may hold a Family Goal.
insert into family_goals (id, year_id, text) values
  ('00000000-0000-4000-8000-0000000000ba', '00000000-0000-4000-8000-0000000000d1', 'Camping trip');

select lives_ok($$
  update tiles set family_goal_id = '00000000-0000-4000-8000-0000000000ba'
   where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 12
$$, 'the Center Tile may hold the Family Goal');

select throws_ok($$
  update tiles set family_goal_id = '00000000-0000-4000-8000-0000000000ba'
   where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 7
$$, '23514', null, 'a Family Goal on any Tile but position 12 is rejected');

-- A Tile holds at most one kind of Goal.
insert into goals (id, text, target) values
  ('00000000-0000-4000-8000-0000000000bb', 'Read more books', 12);
select throws_ok($$
  update tiles set goal_id = '00000000-0000-4000-8000-0000000000bb'
   where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 12
$$, '23514', null, 'a Tile holding a Family Goal cannot also hold a personal Goal');

-- target = 1 IS the one-shot shape; 0 is not a shape at all (ADR-0002).
select throws_ok($$insert into goals (text, target) values ('Impossible', 0)$$,
  '23514', null, 'a Target below 1 is rejected');
select lives_ok($$insert into goals (text, target) values ('Learn to swim', 1)$$,
  'a Target of 1 is the one-shot shape and is perfectly legal');

-- Category is a closed set; NULL is legal for a Goal that skipped Sharpening.
select throws_ok($$insert into goals (text, target, category) values ('X', 1, 'vibes')$$,
  '23514', null, 'an unknown Category is rejected');
select lives_ok($$insert into goals (text, target, category) values ('X', 1, null)$$,
  'a Goal that skipped Sharpening leaves Category NULL and is still valid');

-- Three Swaps per Member per Year, enforced in the database (PRD §18.1).
-- The trigger on `revisions` is what keeps the counter honest.
select lives_ok($$
  insert into revisions (board_id, tile_id, after_text, after_target)
  select '00000000-0000-4000-8000-0000000000b1', id, 'Swapped', 1
    from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position < 3
$$, 'three Swaps are permitted');

select is((select swaps_used from boards where id = '00000000-0000-4000-8000-0000000000b1'),
  3, 'the Revision trigger keeps boards.swaps_used in step with the log');

select throws_ok($$
  insert into revisions (board_id, tile_id, after_text, after_target)
  values ('00000000-0000-4000-8000-0000000000b1',
          (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 4),
          'One too many', 1)
$$, '23514', null, 'a fourth Swap is rejected by the budget CHECK');

-- One Ballot per Member per Vote: changing a vote is an UPDATE, not a second row.
insert into votes (id, year_id, kind, closes_at) values
  ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000d1',
   'mode', '2027-01-01T05:00:00Z');
insert into ballots (vote_id, member_id, choice_mode) values
  ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000e1', 'shared');
select throws_ok($$
  insert into ballots (vote_id, member_id, choice_mode) values
    ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000e1', 'personal')
$$, '23505', null, 'a second Ballot from the same Member on the same Vote is rejected');

-- Milestone idempotence: this is the database half of PRD §12.2, and what stops an
-- offline replay from firing the completion animation twice.
insert into milestones (member_id, year_id, type, tile_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'tile_completed',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0));
select throws_ok($$
  insert into milestones (member_id, year_id, type, tile_id) values
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'tile_completed',
     (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0))
$$, '23505', null, 'a Tile cannot be completed twice');

insert into milestones (member_id, year_id, type, line_index) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'bingo', 0);
select throws_ok($$
  insert into milestones (member_id, year_id, type, line_index) values
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'bingo', 4)
$$, '23505', null, 'a Member has at most one Bingo, ever — the first Line they close');

select throws_ok($$
  insert into milestones (member_id, year_id, type, line_index) values
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'line_completed', 12)
$$, '23514', null, 'a Line index outside 0..11 is rejected');

select * from finish();
rollback;
