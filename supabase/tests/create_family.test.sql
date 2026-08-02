-- Slice 2, server half: create a Family.
--
-- The acceptance test (PRD §2):
--   Given a signed-in Account with no Family
--   When they create a Family named "Hertzell Family"
--   Then the Family exists, they are a Member of it with role organizer, and the Family
--   appears on their home screen
--
-- "Appears on their home screen" is a read through RLS, so it is testable here: after
-- the call, `select * from families` as that caller must return it.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- Alice arrives from Sign in with Apple, which supplies a full name.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test',
   '{"full_name": "Alice Hertzell"}'::jsonb),
  -- Bob signed in with a magic link and gave no name at all.
  ('00000000-0000-4000-8000-0000000000a2', 'bob.okonkwo@example.test', '{}'::jsonb),
  -- Carol came through Apple private relay with no name and a relay address.
  ('00000000-0000-4000-8000-0000000000a3', null, '{}'::jsonb);

-- ---------------------------------------------------------------------------------
-- The acceptance test.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

select lives_ok(
  $$select create_family('Hertzell Family', 'America/New_York')$$,
  'a signed-in Account can create a Family');

select is((select count(*) from families)::int, 1,
  'the Family appears on their home screen — it is readable through RLS immediately');
select is((select name from families), 'Hertzell Family', 'under the name they chose');
select is((select timezone from families), 'America/New_York',
  'carrying the IANA timezone every deadline resolves in (§8.3 T1)');

select is((select count(*) from members)::int, 1, 'with exactly one Member in it');
select is((select role from members), 'organizer',
  'and that Member is the Organizer (§2.1)');
select is((select status from members), 'active',
  'active immediately — there is nobody left to approve them');
select is((select account_id from members), '00000000-0000-4000-8000-0000000000a1'::uuid,
  'backed by the creating Account');
select is((select guardian_account_id from members), null,
  'and not guarded — they are not a Managed Member');
select is((select display_name from members), 'Alice Hertzell',
  'named from the identity provider, because Family creation is one field (§4.5)');

-- ---------------------------------------------------------------------------------
-- Naming (§2.3)
-- ---------------------------------------------------------------------------------

select lives_ok(
  $$select create_family('Hertzell Family', 'America/New_York')$$,
  'Family names are not unique — two unrelated Smith Families are fine (§2.3)');

select throws_ok($$select create_family('', 'UTC')$$, '22023', null,
  'an empty name is rejected');
select throws_ok($$select create_family('   ', 'UTC')$$, '22023', null,
  'a whitespace-only name is rejected');
select throws_ok($$select create_family(repeat('x', 61), 'UTC')$$, '22023', null,
  'a name over 60 characters is rejected (§2.3)');
select lives_ok($$select create_family(repeat('x', 60), 'UTC')$$,
  'exactly 60 characters is allowed');

-- A bad timezone would not surface until pg_cron tried to seal a Year.
select throws_ok($$select create_family('Bad Zone', 'Mars/Olympus_Mons')$$, '22023', null,
  'an unknown IANA timezone is rejected at the only moment anyone is watching');

-- ---------------------------------------------------------------------------------
-- An Account may belong to several Families (§2.2), and nothing crosses between them.
-- ---------------------------------------------------------------------------------

select is((select count(*) from families)::int, 3,
  'an Account may create multiple Families (§2.2)');

select act_as('00000000-0000-4000-8000-0000000000a2');
select lives_ok($$select create_family('Okonkwo Family', 'Europe/London')$$,
  'a second Account creates its own Family');

select is((select count(*) from families)::int, 1,
  'CROSS-FAMILY: bob sees only his own, never alice''s three');
select is((select display_name from members where account_id = '00000000-0000-4000-8000-0000000000a2'),
  'bob.okonkwo', 'a Member with no provider name falls back to the email local part');

-- Carol has neither a name nor an email. The NOT NULL must still not be what fails her
-- sign-up.
select act_as('00000000-0000-4000-8000-0000000000a3');
select lives_ok($$select create_family('Relay Family', 'UTC')$$,
  'an Account with no name and no email can still create a Family');

select * from finish();
rollback;
