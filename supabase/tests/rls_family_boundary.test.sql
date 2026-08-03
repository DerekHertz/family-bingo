-- Nothing crosses a Family boundary. Ever. (PRD §8.1)
--
-- Every assertion below that matters is a NEGATIVE one: an Account in a different
-- Family must get ZERO ROWS, not an error (PRD §8.1 P2, api.md §9). A policy without
-- this test is an untested security control, and the payload behind it is photographs
-- of children (ADR-0004, ADR-0005).

begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- ---------------------------------------------------------------------------------
-- Fixture: two unrelated Families, plus a pending join request.
--
--   Family 1 "Hertzell"  — alice (organizer), theo (Managed, guarded by alice)
--   Family 2 "Okonkwo"   — bob (organizer)
--   carol has followed an Invitation to Family 1 and is still pending.
-- ---------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test');

-- accounts rows are provisioned by the on_auth_user_created trigger (slice 1).

insert into families (id, name, timezone) values
  ('00000000-0000-4000-8000-0000000000f1', 'Hertzell Family', 'America/New_York'),
  ('00000000-0000-4000-8000-0000000000f2', 'Okonkwo Family', 'Europe/London');

insert into members (id, family_id, account_id, guardian_account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a1', null, 'Alice', 'organizer', 'active'),
  -- A Managed Member: no account_id, a guardian_account_id, and no way to log in.
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000f1',
   null, '00000000-0000-4000-8000-0000000000a1', 'Theo', 'member', 'active'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000f2',
   '00000000-0000-4000-8000-0000000000a2', null, 'Bob', 'organizer', 'active'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a3', null, 'Carol', 'member', 'pending');

insert into invitations (id, family_id, token_hash, created_by_member_id, expires_at) values
  ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000f1',
   'hash-for-carol', '00000000-0000-4000-8000-0000000000e1', now() + interval '7 days');

insert into years (id, family_id, calendar_year, status, center_mode, setup_deadline) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
   2027, 'active', 'shared', '2027-01-01T05:00:00Z');

insert into family_goals (id, year_id, text) values
  ('00000000-0000-4000-8000-0000000000ba', '00000000-0000-4000-8000-0000000000d1', 'Camping trip');

insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-0000000000d1', '2027-01-01T05:00:00Z');

insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b1', p from generate_series(0, 24) p;

insert into goals (id, text, target, unit, unit_canonical, category, pace_hint) values
  ('00000000-0000-4000-8000-0000000000bb', 'Read more books', 12, 'books', 'book',
   'learning', 'about 1 a month');

update tiles set goal_id = '00000000-0000-4000-8000-0000000000bb'
  where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 3;
update tiles set family_goal_id = '00000000-0000-4000-8000-0000000000ba'
  where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 12;

-- Both Votes: the Ballot below is a mode Ballot, but a Proposal only belongs to the
-- goal Vote (enforce_proposal_rules).
insert into votes (id, year_id, kind, closes_at) values
  ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000d1',
   'mode', '2027-01-01T05:00:00Z'),
  ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-0000000000d1',
   'goal', '2027-01-01T05:00:00Z');

insert into proposals (id, vote_id, member_id, text) values
  ('00000000-0000-4000-8000-0000000000cb', '00000000-0000-4000-8000-0000000000cc',
   '00000000-0000-4000-8000-0000000000e1', 'Camping trip');

insert into ballots (vote_id, member_id, choice_mode) values
  ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000e1', 'shared');

insert into increments (id, tile_id, member_id, note) values
  ('00000000-0000-4000-8000-0000000000c1',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 3),
   '00000000-0000-4000-8000-0000000000e1', 'finally saw the herons at the pond');

insert into attachments (increment_id, storage_path) values
  ('00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000c1.jpg');

insert into milestones (member_id, year_id, type, tile_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1',
   'tile_completed',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 3));

insert into revisions (board_id, tile_id, before_text, before_target, after_text, after_target) values
  ('00000000-0000-4000-8000-0000000000b1',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 5),
   'Walk every day', 144, 'Walk', 90);

insert into wrapped (id, year_id) values
  ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000d1');
-- `stats` carries the keys stats_has_the_cards requires: §8.2 says encode the card shape
-- as a constraint rather than a convention, so a fixture has to be a real card.
insert into wrapped_member_cards (wrapped_id, member_id, stats) values
  ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000e1',
   '{"tiles_completed": 0, "lines_completed": 0, "blackout": false, "increments": 0,
     "biggest_month": null, "longest_goal_span_days": null, "notes": 0, "photos": 0,
     "swaps_used": 0, "most_exceeded": null}'::jsonb);
insert into wrapped_awards (wrapped_id, member_id, axis, label) values
  ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000e1',
   'most_notes', 'Most Notes Written');

insert into device_tokens (account_id, token, platform) values
  ('00000000-0000-4000-8000-0000000000a1', 'ExponentPushToken[alice]', 'ios');

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function act_as_nobody() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Alice, an active Member of Family 1, sees her Family.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

select is((select count(*) from families)::int, 1, 'alice sees exactly her one Family');
select is((select count(*) from members)::int, 3,
  'alice sees the 3 Members of her Family, including the pending one she must approve');
select is((select count(*) from years)::int, 1, 'alice sees her Family Year');
select is((select count(*) from boards)::int, 1, 'alice sees her Board');
select is((select count(*) from tiles)::int, 25, 'alice sees exactly 25 Tiles');
select is((select count(*) from goals)::int, 1, 'alice sees the Goal on her Board');
select is((select count(*) from family_goals)::int, 1, 'alice sees the Family Goal');
select is((select count(*) from increments)::int, 1, 'alice sees her Increment');
select is((select count(*) from attachments)::int, 1, 'alice sees her Attachment');
select is((select count(*) from milestones)::int, 1, 'alice sees her Milestone');
select is((select count(*) from revisions)::int, 1, 'alice sees the Swap Revision');
select is((select count(*) from votes)::int, 2, 'alice sees both halves of the Center Vote');
select is((select count(*) from proposals)::int, 1, 'alice sees the Proposal');
select is((select count(*) from ballots)::int, 1, 'alice sees the Ballot');
select is((select count(*) from wrapped)::int, 1, 'alice sees Wrapped');
select is((select count(*) from wrapped_member_cards)::int, 1, 'alice sees her Wrapped card');
select is((select count(*) from wrapped_awards)::int, 1, 'alice sees her Award');
select is((select count(*) from invitations)::int, 1, 'alice, the Organizer, sees the Invitation');
select is((select count(*) from device_tokens)::int, 1, 'alice sees her own device token');
select is((select count(*) from accounts)::int, 1,
  'alice sees only her own Account — a Family sees Members, never each others Accounts');

-- ---------------------------------------------------------------------------------
-- Bob, in a different Family, gets ZERO ROWS. Not an error — zero rows.
-- This is the block that PRD §8.1 P2 exists for.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');

select is((select count(*) from families where id = '00000000-0000-4000-8000-0000000000f1')::int,
  0, 'CROSS-FAMILY: bob gets zero rows from families');
select is((select count(*) from members where family_id = '00000000-0000-4000-8000-0000000000f1')::int,
  0, 'CROSS-FAMILY: bob gets zero rows from members');
select is((select count(*) from years)::int, 0, 'CROSS-FAMILY: bob gets zero rows from years');
select is((select count(*) from boards)::int, 0, 'CROSS-FAMILY: bob gets zero rows from boards');
select is((select count(*) from tiles)::int, 0, 'CROSS-FAMILY: bob gets zero rows from tiles');
select is((select count(*) from goals)::int, 0, 'CROSS-FAMILY: bob gets zero rows from goals');
select is((select count(*) from family_goals)::int, 0, 'CROSS-FAMILY: bob gets zero rows from family_goals');
select is((select count(*) from increments)::int, 0, 'CROSS-FAMILY: bob gets zero rows from increments');
select is((select count(*) from attachments)::int, 0,
  'CROSS-FAMILY: bob gets zero rows from attachments — the photographs of children case');
select is((select count(*) from milestones)::int, 0, 'CROSS-FAMILY: bob gets zero rows from milestones');
select is((select count(*) from revisions)::int, 0, 'CROSS-FAMILY: bob gets zero rows from revisions');
select is((select count(*) from votes)::int, 0, 'CROSS-FAMILY: bob gets zero rows from votes');
select is((select count(*) from proposals)::int, 0, 'CROSS-FAMILY: bob gets zero rows from proposals');
select is((select count(*) from ballots)::int, 0, 'CROSS-FAMILY: bob gets zero rows from ballots');
select is((select count(*) from wrapped)::int, 0, 'CROSS-FAMILY: bob gets zero rows from wrapped');
select is((select count(*) from wrapped_member_cards)::int, 0,
  'CROSS-FAMILY: bob gets zero rows from wrapped_member_cards');
select is((select count(*) from wrapped_awards)::int, 0,
  'CROSS-FAMILY: bob gets zero rows from wrapped_awards');
select is((select count(*) from invitations)::int, 0,
  'CROSS-FAMILY: bob gets zero rows from invitations — no fishing for a live token');
select is((select count(*) from device_tokens)::int, 0,
  'CROSS-FAMILY: bob gets zero rows from device_tokens');
select is((select count(*) from accounts where id = '00000000-0000-4000-8000-0000000000a1')::int,
  0, 'CROSS-FAMILY: bob gets zero rows from another Account');

-- Reads are Family-wide, writes are self-only: bob cannot log against alice's Tile.
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c9',
          (select id from tiles limit 1),
          '00000000-0000-4000-8000-0000000000e1')
$$, '42501', null,
  'CROSS-FAMILY: bob cannot write an Increment onto alice''s Board');

-- ---------------------------------------------------------------------------------
-- An unauthenticated caller sees nothing at all.
-- ---------------------------------------------------------------------------------

-- `anon` holds no grant on any application table (20260801000007_grants.sql), so an
-- unauthenticated caller is refused at the table before RLS is ever consulted.
select act_as_nobody();

select throws_ok('select count(*) from families', '42501', null,
  'ANON: cannot reach families at all');
select throws_ok('select count(*) from increments', '42501', null,
  'ANON: cannot reach increments at all');
select throws_ok('select count(*) from attachments', '42501', null,
  'ANON: cannot reach attachments at all');
select throws_ok('select count(*) from members', '42501', null,
  'ANON: cannot reach members at all');

select * from finish();
rollback;
