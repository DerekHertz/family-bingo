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
--      at drain time in the ACCOUNT's timezone. Not the Family's: preferences hang off the
--      Account because a handset has one notification tray, and a window over that one tray
--      cannot have two answers. §8.3 T1 governs Family-scoped domain time — deadlines,
--      freeze, which week a Digest is about — and does not reach a handset's night.
--
-- Milestones are inserted directly rather than earned through 24 Goals and a seal. What
-- is under test is the fan-out and the preference in front of it; the path from an
-- Increment to a Milestone is supabase/tests/complete_tile.test.sql's and lines.test.sql's.

begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

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

-- The clock that window is read on. Seeded from the first Family the Account joined, which
-- is the only guess available before a picker exists — and then it is the ACCOUNT's, which
-- is the whole correction: an Account in a Tokyo Family used to be woken at 03:00 where
-- they were standing, because Tokyo said 16:00.
select is((select p.timezone from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a1'),
  'America/New_York',
  'the zone quiet hours resolve on is seeded from the first Family the Account joined');
select is((select p.timezone from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a3'),
  'Europe/London',
  'a different first Family, a different clock — one per Account, not one per Family');

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

-- The grant on this table is deliberately not column-scoped, so `authenticated` can write
-- the zone. An unparseable one is not one bad row: `at time zone 'Middle/Earth'` raises,
-- and pending_notifications() evaluates it for every row in the batch — so one Member's
-- typo would stop the outbox for everybody. Refused at the write instead.
select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok($$
  update notification_preferences set timezone = 'Middle/Earth'
   where account_id = '00000000-0000-4000-8000-0000000000a2'
$$, '22023', null,
  'NEGATIVE: a zone that is not a zone is refused, rather than breaking every other '
  'Account''s drain at 07:00');

-- ---------------------------------------------------------------------------------
-- One token, one Account — §8.1 crossed by a handset rather than by a query
-- ---------------------------------------------------------------------------------
--
-- `device_tokens` shipped as `unique (account_id, token)`. The ordinary sign-out defeats
-- it: an Account whose OS permission has since been revoked cannot re-mint its token, so
-- nothing is deleted, and the next Account to sign in on that handset registers the same
-- token beside it. Two rows, one tray, and one Family's news on another Family's phone.

select act_as_cron();
delete from device_tokens;
insert into device_tokens (account_id, token, platform)
values ('00000000-0000-4000-8000-0000000000a1', 'ExponentPushToken[one-handset]', 'ios');

select throws_ok($$
  insert into device_tokens (account_id, token, platform)
  values ('00000000-0000-4000-8000-0000000000a2', 'ExponentPushToken[one-handset]', 'android')
$$, '23505', null,
  'NEGATIVE: one handset''s token cannot belong to two Accounts at once');

-- The upsert the client makes on sign-in. It MOVES the handset rather than joining it.
insert into device_tokens (account_id, token, platform, last_seen_at)
values ('00000000-0000-4000-8000-0000000000a2', 'ExponentPushToken[one-handset]', 'android', now())
    on conflict (token) do update
       set account_id   = excluded.account_id,
           platform     = excluded.platform,
           last_seen_at = excluded.last_seen_at;

select is((select count(*)::int from device_tokens
            where token = 'ExponentPushToken[one-handset]'), 1,
  'signing in on a handset moves it rather than adding a second row against the same token');
select is((select d.account_id from device_tokens d
            where d.token = 'ExponentPushToken[one-handset]'),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'and it belongs to whoever is signed in now — which is also what makes the notify '
  'function''s delete-by-token prune exactly the row it meant');

delete from device_tokens;

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

-- No preferences row at all, which the trigger and the backfill both say cannot happen —
-- and which the function has to survive anyway, because the cost of being wrong is silence.
--
-- `wants_notification` used to put its coalesce() INSIDE the select list, where it rescues
-- a NULL column and cannot rescue a query returning NO ROWS. A `returns boolean language
-- sql` body that matches nothing answers NULL, and `if wants_notification(…) then` reads
-- NULL as false — so every kind was dropped, including the three whose own comments say
-- they must never sit behind a switch.
select act_as_cron();
delete from notifications;
delete from notification_preferences where account_id = '00000000-0000-4000-8000-0000000000a3';

select is(wants_notification('00000000-0000-4000-8000-0000000000a3', 'join_approved'), true,
  'an Account with no preferences row reads as the defaults, not as NULL');

insert into notifications (account_id, family_id, kind)
values ('00000000-0000-4000-8000-0000000000a3', family_named('Okonkwo Family'), 'join_approved');
select is(queued_for('00000000-0000-4000-8000-0000000000a3', 'join_approved'), 1,
  'so the answer to a question the recipient asked is still written — the one kind whose '
  'own note says it can never be left behind a switch');

-- Put it back, with an `updated_at` no client should be able to choose. The touch trigger
-- was BEFORE UPDATE only, so the insert path of the client's upsert could write anything
-- into the column a later last-write-wins sync would trust.
insert into notification_preferences (account_id, timezone, updated_at)
values ('00000000-0000-4000-8000-0000000000a3', 'Europe/London', timestamptz '2000-01-01');

select ok(
  (select p.updated_at from notification_preferences p
    where p.account_id = '00000000-0000-4000-8000-0000000000a3') > now() - interval '1 minute',
  'and updated_at is the server''s on the INSERT path as well as the UPDATE path');

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

-- "Held" means the window held it, not that it was written inside one. Those come apart
-- the moment a drain misses a row before 21:00 — and `drain-notifications` runs every
-- minute, so missing one is ordinary rather than exotic. Under the old definition the 20:00
-- row below reported `was_held = false`, the notify function left it out of the batch, and
-- because that dropped the held count to one the batching path was skipped entirely: the
-- Member got two separate pushes at seven in the morning, which is the failure quiet hours
-- exist to prevent, moved by ten hours.
select act_as_cron();
delete from notifications;
insert into notifications (account_id, family_id, year_id, kind)
values ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'),
        year_of('Hertzell Family'), 'tile_completed');
update notifications set created_at = new_york('2027-03-15 20:00')
 where account_id = '00000000-0000-4000-8000-0000000000a2';

select is(
  (select p.was_held from pending_notifications(100, 5, new_york('2027-03-16 07:00')) p
    where p.recipient_account = '00000000-0000-4000-8000-0000000000a2'), true,
  'a row written at eight — an hour before the window opens — and still pending at seven '
  'spent the night behind it, and belongs in the same one line (§4.8)');

-- Ten hours is exactly long enough for somebody to change their mind, and the switch has
-- to mean "and the ones already queued" or it means "from tomorrow".
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-16 07:00')), 1,
  'with the switch still on, the held row goes out at seven');

select act_as('00000000-0000-4000-8000-0000000000a2');
update notification_preferences set tile_completed = false
 where account_id = '00000000-0000-4000-8000-0000000000a2';

select act_as_cron();
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-16 07:00')), 0,
  'and a switch turned off at six stops the row quiet hours had been holding since eight');

select act_as('00000000-0000-4000-8000-0000000000a2');
update notification_preferences set tile_completed = true
 where account_id = '00000000-0000-4000-8000-0000000000a2';

-- The clock that matters is the ACCOUNT's — not the server's, not the Family's.
-- 18:30 in New York is 22:30 in London on this date, and only one of them is asleep.
select act_as_cron();
insert into notifications (account_id, family_id, kind)
values ('00000000-0000-4000-8000-0000000000a3', family_named('Okonkwo Family'), 'setup_closing');
update notification_preferences set quiet_hours = true
 where account_id = '00000000-0000-4000-8000-0000000000a3';

select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 18:30')), 1,
  'half past six for an Account whose clock is New York is not quiet');
select is(due_for('00000000-0000-4000-8000-0000000000a3', new_york('2027-03-15 18:30')), 0,
  'and the same instant for an Account whose clock is London is');

-- ---------------------------------------------------------------------------------
-- ONE Account, TWO Families, TWO zones — the case the pair above never reaches
-- ---------------------------------------------------------------------------------
--
-- The assertions above use two DIFFERENT Accounts in two Families, so they pass just as
-- well when the window is resolved per Family. This is the one that does not. Preferences
-- are Account-scoped precisely because "a phone cannot be told about Alice-in-the-Hertzells
-- while staying quiet about Alice-in-the-Okonkwos — there is one notification tray"; quiet
-- hours are a property of that tray, so the same Account must get the same window whichever
-- Family the news came from.

select act_as_cron();
delete from notifications;
insert into members (family_id, account_id, display_name, role, status)
values (family_named('Okonkwo Family'), '00000000-0000-4000-8000-0000000000a2',
        'Bob abroad', 'member', 'active');

select is((select p.timezone from notification_preferences p
            where p.account_id = '00000000-0000-4000-8000-0000000000a2'), 'America/New_York',
  'joining a second Family does not move an Account''s night — the zone is seeded once');

delete from notifications;
insert into notifications (account_id, family_id, kind) values
  ('00000000-0000-4000-8000-0000000000a2', family_named('Hertzell Family'), 'setup_closing'),
  ('00000000-0000-4000-8000-0000000000a2', family_named('Okonkwo Family'),  'setup_closing');

select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-16 03:00')), 0,
  'NEGATIVE: three in the morning where the phone is holds BOTH Families'' news — read in '
  'London the Okonkwo row says 07:00 and would have buzzed at 03:00 local');
select is(due_for('00000000-0000-4000-8000-0000000000a2', new_york('2027-03-15 20:00')), 2,
  'and eight in the evening releases both — read in London that row says midnight and '
  'would have been held until 02:00 for the phone doing the buzzing');

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
