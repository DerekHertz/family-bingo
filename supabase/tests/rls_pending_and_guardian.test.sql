-- Two boundaries that are easy to get subtly wrong:
--
--   1. A `pending` Member reads NOTHING (PRD §3.2, §8.1 P3). Following an Invitation
--      does not make someone a Member — it asks to become one. This is a hard RLS
--      boundary, not a UI state, because invite links get forwarded into group chats.
--
--   2. A Guardian acts on behalf of a Managed Member (PRD §4.2). Account -> Member is
--      one-to-many, so "the logged-in user" is not "the player" (ADR-0003), and the
--      write path has to check the Member rather than the Account.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test');

-- accounts rows are provisioned by the on_auth_user_created trigger (slice 1).

insert into families (id, name, timezone) values
  ('00000000-0000-4000-8000-0000000000f1', 'Hertzell Family', 'America/New_York'),
  ('00000000-0000-4000-8000-0000000000f2', 'Okonkwo Family', 'Europe/London');

insert into members (id, family_id, account_id, guardian_account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a1', null, 'Alice', 'organizer', 'active'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000f1',
   null, '00000000-0000-4000-8000-0000000000a1', 'Theo', 'member', 'active'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a3', null, 'Carol', 'member', 'pending'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000f2',
   '00000000-0000-4000-8000-0000000000a2', null, 'Bob', 'organizer', 'active');

-- A Year genuinely under way, which since §22 means two instants in the past rather than
-- one: the Boards have sealed AND play has opened. The dates used to sit in 2027 and be
-- read as "sealed, therefore playable"; `tile_is_loggable()` now asks the second question
-- too, and a Year that starts next January answers no however sealed its Boards are.
insert into years (id, family_id, calendar_year, status, center_mode, setup_deadline,
                   play_opens_at) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
   2026, 'active', 'personal', '2026-01-01T05:00:00Z', '2026-01-01T05:00:00Z');

-- Alice's Board and Theo's Board.
insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-0000000000d1', '2026-01-01T05:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000e2',
   '00000000-0000-4000-8000-0000000000d1', '2026-01-01T05:00:00Z');

insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b1', p from generate_series(0, 24) p;
insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b2', p from generate_series(0, 24) p;

-- Every Tile an Increment lands on below needs a Goal: an Increment is progress toward
-- one, and tile_is_loggable() refuses a Tile that holds none (§12.1). Position 1 of
-- alice's Board is authored too, so the cross-Board test below fails on ownership
-- rather than on an empty Tile.
insert into goals (id, text, target) values
  ('00000000-0000-4000-8000-0000000000ba', 'Walk every day', 144),
  ('00000000-0000-4000-8000-0000000000bb', 'Read more books', 12),
  ('00000000-0000-4000-8000-0000000000bc', 'Learn to swim', 10);
update tiles set goal_id = '00000000-0000-4000-8000-0000000000ba'
 where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0;
update tiles set goal_id = '00000000-0000-4000-8000-0000000000bb'
 where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 1;
update tiles set goal_id = '00000000-0000-4000-8000-0000000000bc'
 where board_id = '00000000-0000-4000-8000-0000000000b2' and position = 0;

insert into increments (id, tile_id, member_id) values
  ('00000000-0000-4000-8000-0000000000c1',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0),
   '00000000-0000-4000-8000-0000000000e1');

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Carol has followed a valid Invitation and is pending. She sees NOTHING —
-- not the Feed, not Boards, not other Members' names.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a3');

select is((select count(*) from families)::int, 0, 'PENDING: zero rows from families');
select is((select count(*) from members)::int, 0,
  'PENDING: zero rows from members — not even her own row, and not the other Members'' names');
select is((select count(*) from years)::int, 0, 'PENDING: zero rows from years');
select is((select count(*) from boards)::int, 0, 'PENDING: zero rows from boards');
select is((select count(*) from tiles)::int, 0, 'PENDING: zero rows from tiles');
select is((select count(*) from increments)::int, 0, 'PENDING: zero rows from increments');
select is((select count(*) from visible_family_ids())::int, 0,
  'PENDING: visible_family_ids() is empty, which is what makes all of the above true');

-- She cannot promote herself, either.
select is((select count(*) from members where status = 'active')::int, 0,
  'PENDING: cannot see a Member to promote');

-- ---------------------------------------------------------------------------------
-- Alice guards Theo. She acts AS Theo, and the action is attributed to Theo.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

select is((select count(*) from controlled_member_ids())::int, 2,
  'GUARDIAN: alice controls two Members — herself and Theo');
select ok(
  '00000000-0000-4000-8000-0000000000e2' in (select controlled_member_ids()),
  'GUARDIAN: Theo is one of them');

-- Logging for Theo, on Theo's Board, attributed to Theo (PRD §4.2).
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c2',
          (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b2' and position = 0),
          '00000000-0000-4000-8000-0000000000e2')
$$, 'GUARDIAN: alice may log an Increment as Theo');

select is(
  (select member_id from increments where id = '00000000-0000-4000-8000-0000000000c2'),
  '00000000-0000-4000-8000-0000000000e2'::uuid,
  'GUARDIAN: the Increment is attributed to Theo, not to his Guardian');

-- The write path checks the Member, not the Account: alice cannot log for Theo onto her
-- OWN Board, which is the mistake a naive "is this my account?" check would allow.
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c3',
          (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 1),
          '00000000-0000-4000-8000-0000000000e2')
$$, '42501', null,
  'GUARDIAN: an Increment for Theo cannot be written onto alice''s Board');

-- Increments are append-only. Deleting is the only mutation (PRD §11.3).
select throws_ok(
  $$update increments set note = 'rewritten' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '42501', null,
  'APPEND-ONLY: there is no UPDATE privilege on increments, by design');
select lives_ok(
  $$delete from increments where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'APPEND-ONLY: deleting an Increment is permitted — it is the only mutation');

-- Bob cannot act as anyone in alice's Family.
select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*) from controlled_member_ids())::int, 1,
  'CROSS-FAMILY: bob controls only his own Member');

select * from finish();
rollback;
