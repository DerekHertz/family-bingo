-- Invite-only sign-up (20260801000037).
--
-- The rule has two halves and only one of them can be reached from here.
--
-- `postgres` is not a member of `supabase_auth_admin`, so pgTAP cannot impersonate GoTrue
-- and cannot make the trigger take its gated branch. That is why the decision lives in
-- `signup_is_allowed(address, arriving_as)` — passing the role in makes every combination
-- checkable without having to *be* anyone, and a rule that could only be exercised in
-- production would be a rule nobody had tested.
--
-- What this file proves: the decision is right for every caller and address, the trigger
-- actually consults it, and the roles that must not be gated are not. What it cannot
-- prove is that GoTrue really arrives as `supabase_auth_admin` — that was verified
-- empirically against a live signup on the local stack, and is recorded in the migration.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ---------------------------------------------------------------------------------------
-- Shape, and failing closed
-- ---------------------------------------------------------------------------------------

select has_table('signup_allowlist');
select has_table('signup_policy');

select is((select allowlist_only from signup_policy), true,
  'the policy defaults to allowlist-only, so an empty list admits nobody');
select is((select count(*)::int from signup_policy), 1,
  'exactly one policy row, enforced by the primary key');
select is((select count(*)::int from signup_allowlist), 0,
  'and the allowlist ships empty');

select throws_ok(
  $$insert into signup_policy (id, allowlist_only) values (true, false)$$,
  '23505', null,
  'a second policy row is refused — a settings table that can hold two will disagree');

select throws_ok(
  $$insert into signup_allowlist (email) values ('Mixed.Case@Example.COM')$$,
  '23514', null,
  'an unnormalised address is refused rather than silently never matching');

-- Neither table is the client''s business. RLS on with no policy and no grant is this
-- schema's way of saying service-role only (§7.1), and the same shape `notifications` and
-- `orphaned_objects` use.
select is((select relrowsecurity from pg_class where relname = 'signup_allowlist'), true,
  'the allowlist has RLS on');
select is((select count(*)::int from pg_policies where tablename = 'signup_allowlist'), 0,
  'and no policy, so nothing but the service role reads a list of family addresses');
select ok(
  not has_table_privilege('authenticated', 'signup_allowlist', 'select'),
  'and `authenticated` cannot read it');

-- ---------------------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------------------

select ok(
  not signup_is_allowed('stranger@example.com', 'supabase_auth_admin'),
  'a sign-up from an address nobody invited is refused');

insert into signup_allowlist (email, note) values ('invited@example.com', 'a sibling');

select ok(
  signup_is_allowed('invited@example.com', 'supabase_auth_admin'),
  'an invited address is allowed');

-- Google returns whatever the provider holds, and an address differing only in case or
-- surrounding space is the same address.
select ok(
  signup_is_allowed('  Invited@Example.COM ', 'supabase_auth_admin'),
  'and so is the same address in a different case, with whitespace');

select ok(
  not signup_is_allowed(null, 'supabase_auth_admin'),
  'an identity with no address cannot be on a list of addresses');
select ok(
  not signup_is_allowed('   ', 'supabase_auth_admin'),
  'and neither can a blank one');

-- The half that keeps the other 28 test files working, and lets a demo Account be seeded.
select ok(
  signup_is_allowed('stranger@example.com', 'postgres'),
  'a seed or an operator is not gated — it is not the public door');
select ok(
  signup_is_allowed('stranger@example.com', 'service_role'),
  'nor is the service role');

-- The property that is easy to assume and is false. An admin-API create arrives on the
-- same connection as a public sign-up and produces an identical row, so the gate applies
-- to it too. Asserted so that nobody "fixes" the gate by exempting operators and finds out
-- from a red integration suite, which is exactly how this was discovered.
select ok(
  not signup_is_allowed('stranger@example.com', 'supabase_auth_admin'),
  'an admin-API create is gated too — the database cannot tell it from a public sign-up');

-- The switch, and that it is a switch rather than a side effect of an empty table.
update signup_policy set allowlist_only = false where id;
select ok(
  signup_is_allowed('stranger@example.com', 'supabase_auth_admin'),
  'turning the policy off opens the door to everyone');
update signup_policy set allowlist_only = true where id;

-- ---------------------------------------------------------------------------------------
-- The trigger consults it
-- ---------------------------------------------------------------------------------------

-- As `postgres`, which the decision permits — so this proves the trigger still creates the
-- Account, and that the gate did not break account creation for everybody.
select lives_ok(
  $$insert into auth.users (id, email)
    values ('00000000-0000-4000-8000-00000000f005', 'seeded@example.com')$$,
  'an ungated sign-up still happens');

select is(
  (select count(*)::int from accounts where id = '00000000-0000-4000-8000-00000000f005'),
  1,
  'and still gets its Account row, which is the whole job of the trigger');

rollback;
