-- Slice 15, the preferences half — FRONTEND_DESIGN §4.8.
--
-- Three things are asserted here and they are three different mechanisms:
--
--   1. The defaults a Member gets without asking, and the RLS around them. Preferences
--      are Account-scoped, so PRD §8.1 P2 applies exactly as it does to every other
--      policy: another Account gets ZERO ROWS, not an error.
--   2. A switch turning a push off — which is a fact about whether the outbox row is
--      WRITTEN, not about whether it is sent.
--   3. Quiet hours holding a send, and the boundary — which is a fact about WHEN, decided
--      at drain time in the Family's timezone (§8.3 T1).
--
-- Milestones are inserted directly rather than earned through 24 Goals and a seal. What
-- is under test is the fan-out and the preference in front of it; the path from an
-- Increment to a Milestone is supabase/tests/complete_tile.test.sql's and lines.test.sql's.

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
language sql stable security definer set search_path = public as $$
  select id from members where display_name = name
$$;

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

create or replace function year_of(family text) returns uuid
language sql stable security definer set search_path = public as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

-- The literal square. Nothing here seals a Board, so no deal has happened (§4.1) and the
-- position written is the position held.
create or replace function tile_at(name text, pos int) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from tiles t join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$$;

-- What is waiting to go out for one Account. Read as postgres: the outbox is not a client
-- surface (20260801000029 §9).
create or replace function queued_for(account uuid, of_kind text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications n
   where n.account_id = account and n.kind = of_kind
$$;

-- What the drain would pick up for one Account at a given instant.
create or replace function due_for(account uuid, at_time timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from pending_notifications(100, 5, at_time) p
   where p.recipient_account = account
$$;

-- How many rows an UPDATE actually touched, run as whoever is acting.
--
-- Deliberately NOT security definer: the point is to see the policy refuse. A refused
-- UPDATE is silent — `using` matches nothing, no row is touched, and PostgREST answers 204
-- — so the row count is the only place the refusal shows up. (A data-modifying CTE cannot
-- be wrapped in a scalar subquery, which is the other way one might try to count this.)
create or replace function try_switch_off(target uuid) returns int
language plpgsql as $$
declare touched int;
begin
  update notification_preferences set tile_completed = false where account_id = target;
  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- One instant, three times a day. `at time zone` resolves each in the zone named, so these
-- are wall-clock moments rather than offsets, and DST cannot make them drift.
create or replace function new_york(local text) returns timestamptz
language sql immutable as $$
  select (local::timestamp) at time zone 'America/New_York'
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select act_as_cron();
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');
-- Mia is Alice's Managed Member: a child with no login, played through Alice's Account.
insert into members (family_id, guardian_account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a1', 'Mia', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year(family_named('Hertzell Family'), 2027);

-- A second Family with a second timezone, for the cross-Family negative (§8.1 P2) and for
-- the quiet-hours-is-the-Family's-clock assertion at the end.
select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');

select act_as_cron();
delete from notifications;

-- ---------------------------------------------------------------------------------
-- The defaults a Member gets without asking (§15.1)
-- ---------------------------------------------------------------------------------

select is(
  (select count(*)::int from notification_preferences p
    where p.account_id = '00000000-0000-4000-8000-0000000000a1'), 1,
  'an Account has preferences the moment it exists — nothing has to remember to create them');

select is((select p.tile_completed from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a1'), true,
  'tile completed is on by default (§15.1)');
select is((select p.bingo_blackout from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a1'), true,
  'bingo and blackout are on by default (§15.1)');
select is((select p.almanac from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a1'), true,
  'the Almanac is on by default — once a Year, and it is the payoff (§20)');
select is((select p.quiet_hours from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a1'), false,
  'quiet hours are OFF by default, or §15''s "within 30 seconds" is false ten hours a day');
select is(
  (select p.quiet_start::text || '-' || p.quiet_end::text from notification_preferences p
    where p.account_id = '00000000-0000-4000-8000-0000000000a1'),
  '21:00:00-07:00:00', 'and the window §4.8 names is what they hold when switched on');

-- Preferences hang off the Account, so a Managed Member cannot have any: they have no
-- Account at all. FRONTEND_DESIGN §4.7's "Managed Members receive no notifications" is a
-- consequence of the schema here rather than a rule restated in it.
select is(
  (select count(*)::int from notification_preferences),
  (select count(*)::int from accounts),
  'exactly one row per Account — a Managed Member has no Account and so no preferences (§4.7)');

-- ---------------------------------------------------------------------------------
-- §8.1 P1/P2 — the policy, and the negative case that makes it a tested control
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from notification_preferences), 1,
  'a Member reads their own preferences and nothing else');

select is(
  (select count(*)::int from notification_preferences p
    where p.account_id = '00000000-0000-4000-8000-0000000000a2'), 0,
  'NEGATIVE: a Family-mate''s preferences are ZERO ROWS, not an error (§8.1 P2)');

select act_as('00000000-0000-4000-8000-0000000000a3');
select is(
  (select count(*)::int from notification_preferences p
    where p.account_id = '00000000-0000-4000-8000-0000000000a1'), 0,
  'NEGATIVE: an Account in another Family gets the same zero rows (§8.1 P2)');

-- Writes are self-only.
select act_as('00000000-0000-4000-8000-0000000000a2');
select is(try_switch_off('00000000-0000-4000-8000-0000000000a1'), 0,
  'NEGATIVE: one Member cannot switch another Member''s notifications off');

select act_as_cron();
select is((select p.tile_completed from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a1'), true,
  'and the row is untouched by the attempt');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok($$
  insert into notification_preferences (account_id, tile_completed)
  values ('00000000-0000-4000-8000-0000000000a1', false)
$$, '42501', null,
  'NEGATIVE: nor write a fresh row on their behalf');

select is(try_switch_off('00000000-0000-4000-8000-0000000000a2'), 1,
  'a Member does change their own');

select act_as_cron();
select throws_ok($$
  update notification_preferences set quiet_start = '21:00', quiet_end = '21:00'
   where account_id = '00000000-0000-4000-8000-0000000000a2'
$$, '23514', null,
  'and a zero-length quiet window is refused rather than silently meaning never or always');

-- ---------------------------------------------------------------------------------
-- The window wraps midnight, and the boundary is where that gets decided
-- ---------------------------------------------------------------------------------

select is(within_quiet_hours('20:59', '21:00', '07:00'), false,
  'a minute before nine is not quiet');
select is(within_quiet_hours('21:00', '21:00', '07:00'), true,
  'BOUNDARY: nine o''clock itself is (§4.8)');
select is(within_quiet_hours('03:00', '21:00', '07:00'), true,
  'and the small hours, which is the half a BETWEEN would drop');
select is(within_quiet_hours('06:59', '21:00', '07:00'), true,
  'BOUNDARY: a minute before seven is still quiet');
select is(within_quiet_hours('07:00', '21:00', '07:00'), false,
  'BOUNDARY: seven o''clock is not — §4.8 sends the batch AT 07:00');
select is(within_quiet_hours('12:00', '09:00', '17:00'), true,
  'a window that does not wrap still works');
select is(within_quiet_hours('08:59', '09:00', '17:00'), false,
  'on both sides of it');

-- ---------------------------------------------------------------------------------
-- A switch decides whether the row is WRITTEN
-- ---------------------------------------------------------------------------------

select act_as_cron();
update notification_preferences set tile_completed = true
 where account_id = '00000000-0000-4000-8000-0000000000a2';
delete from notifications;

insert into milestones (member_id, year_id, type, tile_id)
values (member_of('Alice'), year_of('Hertzell Family'), 'tile_completed', tile_at('Alice', 0));

select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'tile_completed'), 1,
  'with the switch on, Bob is told a square fell');
select is(queued_for('00000000-0000-4000-8000-0000000000a1', 'tile_completed'), 0,
  'and Alice, who completed it, still is not (§15.5)');

select act_as('00000000-0000-4000-8000-0000000000a2');
update notification_preferences set tile_completed = false
 where account_id = '00000000-0000-4000-8000-0000000000a2';

select act_as_cron();
insert into milestones (member_id, year_id, type, tile_id)
values (member_of('Alice'), year_of('Hertzell Family'), 'tile_completed', tile_at('Alice', 1));

select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'tile_completed'), 1,
  'with it off, the second Tile writes no row at all — not an unsent one');

insert into milestones (member_id, year_id, type, line_index)
values (member_of('Alice'), year_of('Hertzell Family'), 'bingo', 0);
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'bingo'), 1,
  'the switches are separate: a Bingo still arrives');

select act_as('00000000-0000-4000-8000-0000000000a2');
update notification_preferences set bingo_blackout = false
 where account_id = '00000000-0000-4000-8000-0000000000a2';

select act_as_cron();
insert into milestones (member_id, year_id, type)
values (member_of('Alice'), year_of('Hertzell Family'), 'blackout');
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'blackout'), 0,
  'and one switch covers both halves of §4.8''s pair');

-- The kinds that are deliberately NOT switches. A Member who has turned everything off
-- still hears the things only they can act on.
insert into notifications (account_id, family_id, year_id, kind)
values ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'),
        year_of('Hertzell Family'), 'setup_closing');
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'setup_closing'), 1,
  'the last chance to write a Goal is not behind a switch — the deadline cannot slip');

insert into notifications (account_id, family_id, year_id, kind)
values ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'),
        year_of('Hertzell Family'), 'wrapped');
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'wrapped'), 1,
  'the Almanac arrives while its switch is on');

select act_as('00000000-0000-4000-8000-0000000000a2');
update notification_preferences set almanac = false
 where account_id = '00000000-0000-4000-8000-0000000000a2';

select act_as_cron();
delete from notifications where kind = 'wrapped';
insert into notifications (account_id, family_id, year_id, kind)
values ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'),
        year_of('Hertzell Family'), 'wrapped');
select is(queued_for('00000000-0000-4000-8000-0000000000a2', 'wrapped'), 0,
  'and not while it is off — generate_wrapped() writes this row directly, so a filter '
  'inside notify_family() would have left this switch controlling nothing');

-- ---------------------------------------------------------------------------------
-- Quiet hours decide WHEN, at drain time, in the Family's timezone (§8.3 T1)
-- ---------------------------------------------------------------------------------

select act_as_cron();
delete from notifications;
update notification_preferences
   set tile_completed = true, bingo_blackout = true, almanac = true, quiet_hours = false
 where account_id = '00000000-0000-4000-8000-0000000000a2';

insert into milestones (member_id, year_id, type, tile_id)
values (member_of('Alice'), year_of('Hertzell Family'), 'tile_completed', tile_at('Alice', 2));

select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 22:30')), 1,
  'with quiet hours off, half past ten at night is a fine time to hear a square fell');

select act_as('00000000-0000-4000-8000-0000000000a2');
update notification_preferences set quiet_hours = true
 where account_id = '00000000-0000-4000-8000-0000000000a2';

select act_as_cron();
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 22:30')), 0,
  'with them on, the same row waits — the outbox holds it rather than dropping it');
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 20:59')), 1,
  'BOUNDARY: a minute before nine still goes out');
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 21:00')), 0,
  'BOUNDARY: nine o''clock does not');
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-16 06:59')), 0,
  'BOUNDARY: nor a minute before seven');
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-16 07:00')), 1,
  'BOUNDARY: and at seven the night''s news goes out (§4.8)');

-- What the notify function batches into one line, and what it leaves alone.
update notifications set created_at = new_york('2027-03-15 23:00')
 where account_id = '00000000-0000-4000-8000-0000000000a2' and kind = 'tile_completed';
select is(
  (select p.was_held from pending_notifications(100, 5, new_york('2027-03-16 07:00')) p
    where p.recipient_account = '00000000-0000-4000-8000-0000000000a2'), true,
  'a row written at eleven at night is marked held, and is one line at seven (§4.8)');

update notifications set created_at = new_york('2027-03-16 12:00')
 where account_id = '00000000-0000-4000-8000-0000000000a2' and kind = 'tile_completed';
select is(
  (select p.was_held from pending_notifications(100, 5, new_york('2027-03-16 13:00')) p
    where p.recipient_account = '00000000-0000-4000-8000-0000000000a2'), false,
  'a row written at noon is not, however many of them there are');

-- The clock that matters is the FAMILY's, not the server's and not the recipient's.
-- 18:30 in New York is 22:30 in London on this date, and only one of them is asleep.
insert into notifications (account_id, family_id, kind)
values ('00000000-0000-4000-8000-0000000000a3', family_named('Okonkwo Family'), 'setup_closing');
update notification_preferences set quiet_hours = true
 where account_id = '00000000-0000-4000-8000-0000000000a3';

select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 18:30')), 1,
  'half past six in New York is not quiet');
select is(due_for('00000000-0000-4000-8000-0000000000a3', new_york('2027-03-15 18:30')), 0,
  'and the same instant in London is — quiet hours resolve in the Family''s zone (§8.3 T1)');

-- ---------------------------------------------------------------------------------
-- §4.8 — "a tap opens the Tile the notification is about, not the app"
-- ---------------------------------------------------------------------------------
--
-- Which is only possible if the row the notify function drains carries somewhere to go.

select act_as_cron();
update notification_preferences set quiet_hours = false
 where account_id in ('00000000-0000-4000-8000-0000000000a2',
                      '00000000-0000-4000-8000-0000000000a3');
delete from notifications;

insert into milestones (member_id, year_id, type, tile_id)
values (member_of('Alice'), year_of('Hertzell Family'), 'tile_completed', tile_at('Alice', 3));

select isnt(
  (select p.route_board from pending_notifications(100, 5, now()) p
    where p.recipient_account = '00000000-0000-4000-8000-0000000000a2'
      and p.notification_kind = 'tile_completed'), null,
  'a Tile completion names the Board to open');
select is(
  (select p.route_tile from pending_notifications(100, 5, now()) p
    where p.recipient_account = '00000000-0000-4000-8000-0000000000a2'
      and p.notification_kind = 'tile_completed'), tile_at('Alice', 3),
  'and the square, which is the whole of §4.8''s "not the app"');

-- A Member has at most one Bingo ever (one_bingo_per_year), and one was earned further up
-- to prove the switch. Clearing it is what lets this one be earned through the trigger
-- rather than hand-written, so the row under test is the row the app actually produces.
delete from notifications;
delete from milestones where type = 'bingo';
insert into milestones (member_id, year_id, type, line_index)
values (member_of('Alice'), year_of('Hertzell Family'), 'bingo', 1);

select isnt(
  (select p.route_board from pending_notifications(100, 5, now()) p
    where p.notification_kind = 'bingo'), null,
  'a Bingo carries no Tile, so the Board is reached through the Member and the Year');
select is(
  (select p.route_tile from pending_notifications(100, 5, now()) p
    where p.notification_kind = 'bingo'), null,
  'and the tap opens the Board rather than inventing a square (§13.1)');

delete from notifications;
insert into notifications (account_id, family_id, year_id, kind)
values ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'),
        year_of('Hertzell Family'), 'setup_closing');
select is(
  (select p.route_board from pending_notifications(100, 5, now()) p
    where p.notification_kind = 'setup_closing'), null,
  'and a notification about no Milestone routes nowhere, which opens the app as before');

select * from finish();
rollback;
