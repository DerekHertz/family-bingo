-- Slice 15, server half: Push notifications.
--
-- Acceptance test (PRD §15):
--   Given a Member with push permission granted
--   When another Member in their Family completes a Tile
--   Then they receive a push notification within 30 seconds
--   And when that Member logs a bare Increment
--   Then no push is sent
--
-- "Within 30 seconds" is the Edge Function's job and a Database Webhook's; what the
-- database owes is the row, addressed to the right people and to nobody else. That is
-- what this file is about — and §15.2, the half of the acceptance test that is a
-- guarantee about silence.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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

create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

-- Rows waiting to go out, by kind. Read as postgres: the outbox is not a client surface.
create or replace function queued(of_kind text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications n where n.kind = of_kind
$$;

-- Whether a given Account is being told about something.
create or replace function queued_for(account uuid, of_kind text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications n
   where n.account_id = account and n.kind = of_kind
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
  ('00000000-0000-4000-8000-0000000000a4', 'dave@example.test',  '{"full_name":"Dave"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');
-- Mia is Alice's Managed Member: a child with no login, played through Alice's Account.
insert into members (family_id, guardian_account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a1', 'Mia', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year(family_named('Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks');
select write_goal(tile_of('Mia', 0), 'Practise piano', 2, 'sessions');
-- Row 0 and column 0, authored now because everything after Sealing costs a Swap
-- (CONTEXT.md, Sealing). They are what closes a Line further down.
select write_goal(tile_of('Alice', 1), 'One', 1);
select write_goal(tile_of('Alice', 2), 'Two', 1);
select write_goal(tile_of('Alice', 3), 'Three', 1);
select write_goal(tile_of('Alice', 4), 'Four', 1);
select write_goal(tile_of('Alice', 5), 'Five', 1);
select write_goal(tile_of('Alice', 10), 'Ten', 1);
select write_goal(tile_of('Alice', 15), 'Fifteen', 1);
select write_goal(tile_of('Alice', 20), 'Twenty', 1);

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = family_named('Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Hertzell Family');
-- Everything queued during setup is out of scope here; the Milestone rules are.
delete from notifications;

select act_as_cron();
select is(seal_due_boards(), 3, 'three Boards seal and the Year is under way');

-- ---------------------------------------------------------------------------------
-- §15.2 — the half of the acceptance test that is about silence
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c2');

select act_as_cron();
select is((select count(*)::int from notifications), 0,
  'a bare Increment sends nothing — ~3,300 a year is a one-way door (§15.2, §15.3)');

-- ---------------------------------------------------------------------------------
-- §15.1 — and the half that is about being told
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c3');

select act_as_cron();
-- Three Members, two Accounts: Mia is played through Alice's. Fan-out is per Account,
-- because that is what a device token hangs off.
select is(queued('tile_completed'), 1,
  'the third Increment completes the Tile, and the rest of the Family is told');

select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'tile_completed'), 1,
  'Bob hears about it');

-- §15.5. Alice tapped it; being pushed her own Tile completion is the fastest way to
-- teach someone that notifications are noise.
select is(queued_for('00000000-0000-4000-8000-0000000000a1', 'tile_completed'), 0,
  'the Member who caused it is never notified (§15.5)');

select is(
  (select n.subject_member_id from notifications n
    where n.kind = 'tile_completed' and n.account_id = '00000000-0000-4000-8000-0000000000a2'),
  member_of('Alice'), 'and the row names who it is about, not what to say');

select isnt(
  (select n.milestone_id from notifications n
    where n.kind = 'tile_completed' and n.account_id = '00000000-0000-4000-8000-0000000000a2'),
  null, 'carrying the Milestone it came from');

select is(
  (select count(*)::int from notifications n where n.sent_at is not null), 0,
  'nothing is sent yet — the row is an outbox entry, not a delivery');

-- ---------------------------------------------------------------------------------
-- §15.5 with a Guardian, which is where the rule is easy to get wrong
-- ---------------------------------------------------------------------------------
--
-- Alice taps for Mia. The Milestone is attributed to Mia (§4.2), but Alice's thumb did
-- it. Excluding `members.account_id` alone would leave Alice — Mia's backer through
-- `guardian_account_id` — being pushed a notification about a tap she just made.

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Mia', 0, '00000000-0000-4000-8000-0000000000d1');
select tap('Mia', 0, '00000000-0000-4000-8000-0000000000d2');

select act_as_cron();
select is(queued('tile_completed'), 2, 'Mia''s Tile completes and the Family is told');
select is(
  (select count(*)::int from notifications n
    where n.kind = 'tile_completed' and n.subject_member_id = member_of('Mia')), 1,
  'exactly one recipient — the Family is three Members but two Accounts');
select is(
  (select n.account_id from notifications n
    where n.kind = 'tile_completed' and n.subject_member_id = member_of('Mia')),
  '00000000-0000-4000-8000-0000000000a2', 'and it is Bob');
select is(
  (select count(*)::int from notifications n
    where n.kind = 'tile_completed' and n.subject_member_id = member_of('Mia')
      and n.account_id = '00000000-0000-4000-8000-0000000000a1'), 0,
  'GUARDIAN: Alice tapped it for Mia, so Alice is not told (§15.5, §4.2)');

-- ---------------------------------------------------------------------------------
-- §13.2 meets §15.1 — a Line is not always worth a phone buzzing
-- ---------------------------------------------------------------------------------
--
-- Bingo is. `line_completed` is the quieter one by construction (§13.2) and api.md §6
-- lists only Tile completed, Bingo and Blackout as push-worthy. A Member closing their
-- eighth Line is Feed news.

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 1, '00000000-0000-4000-8000-0000000000e1');
select tap('Alice', 2, '00000000-0000-4000-8000-0000000000e2');
select tap('Alice', 3, '00000000-0000-4000-8000-0000000000e3');
select tap('Alice', 4, '00000000-0000-4000-8000-0000000000e4');

select act_as_cron();
select is(queued('bingo'), 1, 'row 0 closes and the Bingo is pushed (§15.1)');
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'bingo'), 1, 'to Bob');
select is(queued_for('00000000-0000-4000-8000-0000000000a1', 'bingo'), 0,
  'and not to Alice, who did it');

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 5, '00000000-0000-4000-8000-0000000000e5');
select tap('Alice', 10, '00000000-0000-4000-8000-0000000000e6');
select tap('Alice', 15, '00000000-0000-4000-8000-0000000000e7');
select tap('Alice', 20, '00000000-0000-4000-8000-0000000000e8');

select act_as_cron();
select is((select count(*)::int from milestones m where m.type = 'line_completed'), 1,
  'column 0 closes as a line_completed');
select is(queued('line_completed'), 0,
  'which is Feed news, not a phone buzzing (§13.2, api.md §6)');
select is(queued('bingo'), 1, 'and it is not a second Bingo either');

-- ---------------------------------------------------------------------------------
-- Joining, both sides of it
-- ---------------------------------------------------------------------------------

select act_as_cron();
delete from notifications;

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a4', 'Dave', 'member', 'pending');

select is(queued('join_requested'), 1,
  'someone is waiting, and the Organizer is the only person who can act on it');
select is(queued_for('00000000-0000-4000-8000-0000000000a1', 'join_requested'), 1,
  'so only the Organizer is told');
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'join_requested'), 0,
  'Bob cannot approve anyone, so Bob is not interrupted');

select act_as('00000000-0000-4000-8000-0000000000a1');
select approve_member(member_of('Dave'));

select act_as_cron();
select is(queued_for('00000000-0000-4000-8000-0000000000a4', 'join_approved'), 1,
  'and the person who was waiting is told they are in (§15.1)');

-- ---------------------------------------------------------------------------------
-- §3.2 — a pending Member hears nothing
-- ---------------------------------------------------------------------------------

select act_as_cron();
delete from notifications;

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a3', 'Carol', 'member', 'pending');
delete from notifications where kind = 'join_requested';

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000f1');

select act_as_cron();
select is(queued_for('00000000-0000-4000-8000-0000000000a3', 'tile_completed'), 0,
  'PENDING: a Member awaiting approval is told nothing about a Family they have not joined');

-- ---------------------------------------------------------------------------------
-- The 24-hour warning
-- ---------------------------------------------------------------------------------

select act_as_cron();
delete from notifications;

select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');
select open_year(family_named('Okonkwo Family'), 2028);

select act_as_cron();
delete from notifications;

select is(notify_setup_closing(), 0,
  'a Setup Window with weeks to run warns nobody');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() + interval '6 hours'
 where id = year_of('Okonkwo Family');

select is(notify_setup_closing(), 1, 'inside 24 hours, the Family is warned');
select is(queued_for('00000000-0000-4000-8000-0000000000a3', 'setup_closing'), 1,
  'everyone active gets it — including whoever thinks they have finished');

-- Once per Year, ever. The outbox is its own record of having warned; the hourly cron
-- must not turn that into twenty-four pushes.
select is(notify_setup_closing(), 1, 'the hourly job finds the Year again');
select is(queued_for('00000000-0000-4000-8000-0000000000a3', 'setup_closing'), 1,
  'but sends no second warning — the partial unique index refuses it');

-- ---------------------------------------------------------------------------------
-- A notification is addressed to one Account
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from notifications), 0,
  'Bob sees none of the Okonkwo Family''s outbox — and none of his own Family''s here');

select throws_ok($$
  insert into notifications (account_id, family_id, kind)
  values ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'), 'bingo')
$$, '42501', null,
  'and no client may decide what a Family gets interrupted for');

select * from finish();
rollback;
