-- Slice 7, database half: the Sharpening rate limit (PRD §7.8).
--
-- 100 calls per Member per Year — generous enough never to be hit while authoring 24
-- Goals, bounded against a runaway loop.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test', '{"full_name":"Bob"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');
select create_managed_member((select id from families limit 1), 'Theo');
select open_year((select id from families limit 1), 2027);

-- Bob has his own Family, so every cross-Family assertion below is real.
select act_as('00000000-0000-4000-8000-0000000000a2');
select create_family('Okonkwo Family', 'Europe/London');
select open_year((select id from families where name = 'Okonkwo Family'), 2027);

select act_as('00000000-0000-4000-8000-0000000000a1');

select is(sharpen_limit_per_year(), 100, 'the limit is 100 per Member per Year (§7.8)');

select is(
  sharpen_budget_remaining(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  100, 'a Member starts with the full budget');

select is((select count(*) from sharpen_usage)::int, 0,
  'and no row until the first call is spent');

-- ---------------------------------------------------------------------------------
-- Spending
-- ---------------------------------------------------------------------------------

select is(
  consume_sharpen(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  99, 'spending one leaves 99');

select is(
  consume_sharpen(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  98, 'and the next leaves 98');

-- A Guardian spends the child's budget, not their own (§4.2).
select is(
  consume_sharpen(
    (select id from members where display_name = 'Theo'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  99, 'a Guardian sharpening for their Managed Member spends THAT Member''s budget');

select is(
  sharpen_budget_remaining(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  98, 'and leaves the Guardian''s own budget untouched');

-- ---------------------------------------------------------------------------------
-- Exhaustion
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
update sharpen_usage set used = 99
 where member_id = (select id from members where display_name = 'Alice');
select act_as('00000000-0000-4000-8000-0000000000a1');

select is(
  consume_sharpen(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  0, 'the hundredth call is allowed and leaves nothing');

select throws_ok($$
  select consume_sharpen(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family')))
$$, 'PT429', null, 'the hundred-and-first is refused (§7.8)');

select is(
  sharpen_budget_remaining(
    (select id from members where display_name = 'Alice'),
    (select id from years where family_id = (select id from families where name = 'Hertzell Family'))),
  0, 'and the remaining budget never goes negative');

-- The budget is per YEAR, so next year starts clean (§20.11 — nothing carries over).
select set_config('role', 'postgres', true);
select open_year((select id from families where name = 'Hertzell Family'), 2028);
select act_as('00000000-0000-4000-8000-0000000000a1');
select is(
  sharpen_budget_remaining(
    (select id from members where display_name = 'Alice'),
    (select id from years where calendar_year = 2028
       and family_id = (select id from families where name = 'Hertzell Family'))),
  100, 'a new Year starts with a full budget — nothing carries over (§20.11)');

-- ---------------------------------------------------------------------------------
-- The boundary
-- ---------------------------------------------------------------------------------

-- Captured as postgres so bob passes a REAL id he simply does not control, rather than
-- a NULL from a subquery RLS already emptied.
select set_config('role', 'postgres', true);
create temp table alice_ids as
  select (select id from members where display_name = 'Alice') as member_id,
         (select id from years
           where family_id = (select id from families where name = 'Hertzell Family')
             and calendar_year = 2027) as year_id;

select act_as('00000000-0000-4000-8000-0000000000a2');

select throws_ok($$
  select consume_sharpen(
    (select member_id from alice_ids), (select year_id from alice_ids))
$$, '42501', null,
  'CROSS-FAMILY: bob cannot spend another Family Member''s Sharpening budget, even '
  'knowing the exact ids');

select is((select count(*) from sharpen_usage)::int, 0,
  'CROSS-FAMILY: and cannot see that they have spent any');

select act_as('00000000-0000-4000-8000-0000000000a1');
select is((select count(*) from sharpen_usage)::int, 2,
  'while her own Family''s usage is visible to her');

select throws_ok($$
  update sharpen_usage set used = 0
$$, '42501', null,
  'nobody writes the counter directly — consume_sharpen() owns it');

select * from finish();
rollback;
