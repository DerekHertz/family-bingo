-- The demo Account (20260801000039), and the two things it must never be able to do.
--
-- The demo is a public, unauthenticated door onto a real Account in a real database, so the
-- assertions that matter here are the negative ones (§8.1 P2):
--
--   * the demo Account reads **zero rows** of any other Family, and
--   * no other Account writes **anything** into the demo Family.
--
-- Plus the third property, which is the one the whole design rests on: read-only is not new
-- code. The demo Family's Year is frozen, and §20.1's existing enforcement — `tile_is_loggable()`
-- inside `increments_own_insert`/`_delete`, and `swap_tile()`'s own guard — is what makes it
-- read-only. This file asserts that against the demo Family's actual shape rather than
-- trusting that a rule tested elsewhere applies here too.
--
-- What 20260801000039 adds is only the writes a frozen Year cannot reach, and those are
-- checked by **message** as well as by SQLSTATE. Both the trigger and a bare RLS refusal
-- raise 42501, so a test matching the code alone would pass for the wrong reason.

begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- ---------------------------------------------------------------------------------------
-- Fixture: the demo Family with a frozen Year, and one unrelated Family with a live one.
--
--   Demo Family   — nadia (organizer), sam (THE DEMO ACCOUNT, an ordinary Member)
--   Other Family  — omar (organizer), a sealed and unfrozen Year
--
-- Sam is deliberately not the Organizer, which is what refuses inviting, approving,
-- removing and opening next Year without a line of new code.
-- ---------------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000da01', 'demo@family-bingo.pages.dev'),
  ('00000000-0000-4000-8000-00000000da02', 'nadia@family-bingo.pages.dev'),
  ('00000000-0000-4000-8000-00000000da03', 'omar@example.test');

insert into families (id, name, timezone) values
  ('00000000-0000-4000-8000-00000000df01', 'The Demo Family', 'Europe/London'),
  ('00000000-0000-4000-8000-00000000df02', 'The Other Family', 'Europe/London');

insert into members (id, family_id, account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-00000000de01', '00000000-0000-4000-8000-00000000df01',
   '00000000-0000-4000-8000-00000000da01', 'Sam', 'member', 'active'),
  ('00000000-0000-4000-8000-00000000de02', '00000000-0000-4000-8000-00000000df01',
   '00000000-0000-4000-8000-00000000da02', 'Nadia', 'organizer', 'active'),
  ('00000000-0000-4000-8000-00000000de03', '00000000-0000-4000-8000-00000000df02',
   '00000000-0000-4000-8000-00000000da03', 'Omar', 'organizer', 'active');

insert into years (id, family_id, calendar_year, status, center_mode, setup_deadline, sealed_at, frozen_at) values
  ('00000000-0000-4000-8000-00000000dc01', '00000000-0000-4000-8000-00000000df01',
   2026, 'frozen', 'shared', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z'),
  ('00000000-0000-4000-8000-00000000dc02', '00000000-0000-4000-8000-00000000df02',
   2027, 'active', 'personal', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', null);

insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-00000000db01', '00000000-0000-4000-8000-00000000de01',
   '00000000-0000-4000-8000-00000000dc01', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000db02', '00000000-0000-4000-8000-00000000de03',
   '00000000-0000-4000-8000-00000000dc02', '2027-01-01T00:00:00Z');

insert into goals (id, text, target) values
  ('00000000-0000-4000-8000-00000000dd01', 'Walk the dog before work', 200),
  ('00000000-0000-4000-8000-00000000dd02', 'Something private', 10);

insert into tiles (id, board_id, position, goal_id) values
  ('00000000-0000-4000-8000-00000000ea01', '00000000-0000-4000-8000-00000000db01', 0,
   '00000000-0000-4000-8000-00000000dd01'),
  ('00000000-0000-4000-8000-00000000ea02', '00000000-0000-4000-8000-00000000db02', 0,
   '00000000-0000-4000-8000-00000000dd02');

-- One Increment on each Board, written before the demo Year was frozen in any real
-- timeline. `stamp_increment()` only refuses an `occurred_at` before the seal.
insert into increments (id, tile_id, member_id, occurred_at) values
  ('00000000-0000-4000-8000-00000000eb01', '00000000-0000-4000-8000-00000000ea01',
   '00000000-0000-4000-8000-00000000de01', '2026-06-01T09:00:00Z'),
  ('00000000-0000-4000-8000-00000000eb02', '00000000-0000-4000-8000-00000000ea02',
   '00000000-0000-4000-8000-00000000de03', '2027-06-01T09:00:00Z');

-- The marker. Everything below turns on this one row existing.
insert into demo_account (id, account_id)
  values (true, '00000000-0000-4000-8000-00000000da01');

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- Back to the owner. Needed because `act_as` is transaction-local and everything after it
-- would otherwise still be running as `authenticated`.
create or replace function act_as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Shape. The marker is service-role only, like every other table in this schema that the
-- client has no business reading.
-- ---------------------------------------------------------------------------------------

select has_table('demo_account');
select has_table('demo_login_attempts');

select is((select relrowsecurity from pg_class where relname = 'demo_account'), true,
  'demo_account has RLS on');
select is((select count(*)::int from pg_policies where tablename = 'demo_account'), 0,
  'and no policy, so nothing but the service role can read which Account the demo is');
select ok(not has_table_privilege('authenticated', 'demo_account', 'select'),
  'and `authenticated` cannot read it either');
select ok(not has_table_privilege('authenticated', 'demo_login_attempts', 'select'),
  'nor the rate-limit counters');

select is((select count(*)::int from demo_account), 1,
  'exactly one demo Account, enforced by the primary key');
select throws_ok(
  $$insert into demo_account (id, account_id)
    values (true, '00000000-0000-4000-8000-00000000da03')$$,
  '23505', null,
  'a second row is refused — "which of these two is the demo" has no safe default');

-- ---------------------------------------------------------------------------------------
-- The question every guard asks
-- ---------------------------------------------------------------------------------------

select ok(is_demo_account('00000000-0000-4000-8000-00000000da01'),
  'the seeded Account is the demo Account');
select ok(not is_demo_account('00000000-0000-4000-8000-00000000da03'),
  'and nobody else is');
select ok(not is_demo_account(null),
  'NULL is not — which is what `postgres`, `service_role` and the seed script all present');

-- ---------------------------------------------------------------------------------------
-- The five writes that live outside a Year, and therefore outside §20.1
--
-- Checked by message as well as SQLSTATE: a bare RLS refusal is also 42501, and a test
-- that matched only the code would pass whether or not the trigger existed.
-- ---------------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-00000000da01');

select throws_ok(
  $$select create_family('A Family Of My Own', 'UTC')$$,
  '42501', 'the demo Account cannot change anything',
  'the demo Account cannot create a Family — a shared public session that could would fill the database');

select throws_ok(
  $$select create_managed_member('00000000-0000-4000-8000-00000000df01', 'Someone New')$$,
  '42501', 'the demo Account cannot change anything',
  'nor add a Member to the Family it is in');

select throws_ok(
  $$update members set display_name = 'Not Sam'
     where id = '00000000-0000-4000-8000-00000000de01'$$,
  '42501', 'the demo Account cannot change anything',
  'nor rename itself, which every later visitor would then see');

select throws_ok(
  $$select delete_account()$$,
  '42501', 'the demo Account cannot change anything',
  'nor delete itself and take the whole demo with it');

-- The Organizer-only surface needs nothing new, and this is why: Sam is an ordinary Member.
select throws_ok(
  $$select open_year('00000000-0000-4000-8000-00000000df01', 2028)$$,
  '42501', 'only the Organizer may open a Year',
  'and Wrapped''s final card is refused by a check that already existed, not by a new one');

-- ---------------------------------------------------------------------------------------
-- §8.1 P2 — the demo Account reads zero rows of any other Family
-- ---------------------------------------------------------------------------------------

select is((select count(*)::int from members where family_id = '00000000-0000-4000-8000-00000000df02'), 0,
  'the demo Account sees none of another Family''s Members');
select is((select count(*)::int from boards where id = '00000000-0000-4000-8000-00000000db02'), 0,
  'none of its Boards');
select is((select count(*)::int from goals where id = '00000000-0000-4000-8000-00000000dd02'), 0,
  'none of its Goals');
select is((select count(*)::int from increments where id = '00000000-0000-4000-8000-00000000eb02'), 0,
  'none of its Increments');
select is((select count(*)::int from feed where year_id = '00000000-0000-4000-8000-00000000dc02'), 0,
  'and nothing of its Feed');
select is((select count(*)::int from families), 1,
  'one Family is visible to it, and it is its own');

-- ---------------------------------------------------------------------------------------
-- §20.1 — the demo Family is read-only because its Year is frozen, and for no other reason
-- ---------------------------------------------------------------------------------------

select ok(not tile_is_loggable('00000000-0000-4000-8000-00000000ea01'),
  'a Tile in a frozen Year is not loggable — the whole read-only mechanism, already tested');

select throws_ok(
  $$insert into increments (id, tile_id, member_id)
    values (gen_random_uuid(), '00000000-0000-4000-8000-00000000ea01',
            '00000000-0000-4000-8000-00000000de01')$$,
  '42501', null,
  'so the demo Account cannot log an Increment on its own Board');

-- Immutable in both directions. A DELETE refused by RLS removes no rows and raises nothing,
-- so the assertion has to be that the row is still there.
delete from increments where id = '00000000-0000-4000-8000-00000000eb01';
select is((select count(*)::int from increments where id = '00000000-0000-4000-8000-00000000eb01'), 1,
  'and cannot delete one either — `increments_own_delete` routes through the same check');

select throws_ok(
  $$select swap_tile('00000000-0000-4000-8000-00000000ea01', 'Something else', 5)$$,
  '42501', 'this Year is frozen',
  'and `swap_tile()` refuses before it checks anything else');

-- ---------------------------------------------------------------------------------------
-- §8.1 P2, the other direction — nobody else writes into the demo Family
-- ---------------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-00000000da03');

select is((select count(*)::int from members where family_id = '00000000-0000-4000-8000-00000000df01'), 0,
  'an unrelated Account sees none of the demo Family''s Members');
select is((select count(*)::int from increments where id = '00000000-0000-4000-8000-00000000eb01'), 0,
  'and none of its Increments');

select throws_ok(
  $$insert into increments (id, tile_id, member_id)
    values (gen_random_uuid(), '00000000-0000-4000-8000-00000000ea01',
            '00000000-0000-4000-8000-00000000de01')$$,
  '42501', null,
  'and cannot write one into it');

select throws_ok(
  $$select swap_tile('00000000-0000-4000-8000-00000000ea01', 'Mine now', 5)$$,
  '42501', 'that is not your Board',
  'nor swap a Tile on a Board that is not theirs');

-- The guard is about the demo Account and nobody else. Without this, a trigger that refused
-- every caller would pass every assertion above.
select lives_ok(
  $$update members set display_name = 'Omar B'
     where id = '00000000-0000-4000-8000-00000000de03'$$,
  'an ordinary Account still renames itself — the guard names the demo Account, not everyone');
select lives_ok(
  $$select create_family('Another Family', 'UTC')$$,
  'and still creates a Family');

-- ---------------------------------------------------------------------------------------
-- The door's rate limit
-- ---------------------------------------------------------------------------------------

select act_as_owner();

select ok(has_function_privilege('service_role', 'demo_login_allowed(text)', 'execute'),
  'the Edge Function can count an attempt');
select ok(not has_function_privilege('authenticated', 'demo_login_allowed(text)', 'execute'),
  'and nobody else can spend the global bucket without going through the door it guards');

delete from demo_login_attempts;

select is((select bool_and(demo_login_allowed('a-caller')) from generate_series(1, 5) n), true,
  'five attempts from one caller are allowed — a reload and a change of browser are not a script');
select ok(not demo_login_allowed('a-caller'),
  'the sixth is refused');
select ok(not demo_login_allowed('a-caller'),
  'and stays refused, because a refused attempt is still counted');

select ok(not demo_login_allowed(''),
  'a caller with no handle is refused rather than sharing an unlimited bucket');
select ok(not demo_login_allowed('*'),
  'and nobody may present the global bucket''s own name');

delete from demo_login_attempts;

select is((select bool_and(demo_login_allowed('caller-' || n)) from generate_series(1, 60) n), true,
  'sixty different callers inside one window are all allowed');
select ok(not demo_login_allowed('caller-61'),
  'the sixty-first is refused — the global cap is what bounds a distributed caller');

select * from finish();
rollback;
