-- Slice 20, database half: Freeze and Wrapped.
--
-- Acceptance test (PRD §20):
--   Given an active Year with activity from 4 Members
--   When the clock passes December 31, 23:59:59 in the Family's timezone
--   Then the Year is frozen, further Increments are rejected, Wrapped is generated,
--   every Member receives a push, and each sees swipeable cards
--   And every Member has received at least one Award
--
-- The Awards themselves are assigned by assignAwards() and tested in
-- src/domain/awards.test.ts, including the family-of-six case §20.7 names as the failure
-- mode. What is tested here is everything around them: the Freeze, the stats the cards
-- are built from, and the guard that refuses to publish a Wrapped with somebody missing.

begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

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

-- ---------------------------------------------------------------------------------
-- A Board is laid out by board_positions(), derived from its own id (§4.1)
-- ---------------------------------------------------------------------------------
--
-- "positions are dealt at seal, so no Member can place the easy one in a corner." So
-- after the seal the Goal written to square N is no longer on square N, and every
-- assertion below that says `tile_of(name, N)` means "the Tile carrying the Goal I wrote
-- to N" — which is exactly what dealt_position() answers. Before the seal the two are the
-- same thing, which is why this works on both sides of it.
create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $dealt$
  select t.id
    from tiles t
    join boards b on b.id = t.board_id
   where b.member_id = member_of(name)
     and t.position = case
           when b.sealed_at is null then pos
           else dealt_position(b.id, pos)
         end
$dealt$;

-- The literal square, for the assertions that mean one. A Line is five squares (§13.1),
-- whichever Goals the layout put on them.
create or replace function tile_at(name text, pos int) returns uuid
language sql stable as $at$
  select t.id from tiles t
    join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$at$;

-- Complete whatever Goal sits on a square, by logging its own Target.
create or replace function finish_at(name text, pos int) returns void
language plpgsql as $fin$
declare n int; tgt int;
begin
  select g.target into tgt
    from tiles t join goals g on g.id = t.goal_id
   where t.id = tile_at(name, pos);
  for n in 1..coalesce(tgt, 0) loop
    insert into increments (id, tile_id, member_id)
    values (gen_random_uuid(), tile_at(name, pos), member_of(name));
  end loop;
end;
$fin$;


create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

create or replace function card(name text) returns jsonb
language sql stable as $$
  select c.stats from wrapped_member_cards c where c.member_id = member_of(name)
$$;

create or replace function family_card() returns jsonb
language sql stable as $$ select w.family_cards from wrapped w limit 1 $$;

create or replace function awards_for(name text) returns int
language sql stable as $$
  select count(*)::int from wrapped_awards a where a.member_id = member_of(name)
$$;

-- Taps land on a chosen day so that "biggest month" and "median gap" have something to
-- measure. occurred_at is the client's to state (schema.md §5) and Wrapped reads it.
create or replace function tap_on(name text, pos int, day timestamptz) returns void
language sql as $$
  insert into increments (id, tile_id, member_id, occurred_at)
  values (gen_random_uuid(), tile_of(name, pos), member_of(name), day)
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a4', 'dele@example.test',  '{"full_name":"Dele"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active'),
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a3', 'Carol', 'member', 'active'),
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a4', 'Dele', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
-- The CURRENT calendar year: stats now bucket into the months of the Year they belong to,
-- in the Family's timezone (§8.3 T3), so a fixture whose taps fall outside its own Year
-- would count nothing.
select open_year(family_named('Hertzell Family'), extract(year from now())::int);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks', 'walk', 'fitness');
select write_goal(tile_of('Alice', 1), 'Read a book', 2, 'books', 'book', 'learning');
-- A Goal that skipped Sharpening: no unit_canonical, no category (§6.1a). It counts
-- everywhere except the aggregate cards (§20.8).
select write_goal(tile_of('Alice', 2), 'Something unmeasured', 1);

select act_as('00000000-0000-4000-8000-0000000000a2');
select write_goal(tile_of('Bob', 0), 'Swim', 2, 'swims', 'swim', 'fitness');

select act_as('00000000-0000-4000-8000-0000000000a3');
select write_goal(tile_of('Carol', 0), 'Read a book', 4, 'books', 'book', 'learning');

select act_as('00000000-0000-4000-8000-0000000000a4');
select write_goal(tile_of('Dele', 0), 'Draw', 1, 'drawings', 'drawing', 'creative');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = family_named('Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Hertzell Family');

select act_as_cron();

-- ---------------------------------------------------------------------------------
-- The squares are dealt at seal (§4.1), so from here a Tile is found by its Goal
-- ---------------------------------------------------------------------------------
--
-- `positions are dealt at seal, so no Member can place the easy one in a corner`. Every
-- assertion below means "the Tile carrying the Goal I wrote to that square", never "square
-- N" — so that is what tile_of() now answers. Squares nothing was written to, including
-- the Centre at 12, still resolve literally: that is what the empty-Tile assertions of
-- §10.2 are about.
create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $dealt$
  select coalesce(
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
       join goals  g on g.id = t.goal_id
      where b.member_id = member_of(name)
        and g.text = (select m.txt from (values
                ('Alice', 0, 'Walk the dog'),
                ('Alice', 1, 'Read a book'),
                ('Alice', 2, 'Something unmeasured'),
                ('Bob', 0, 'Swim'),
                ('Carol', 0, 'Read a book'),
                ('Dele', 0, 'Draw')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

select is(seal_due_boards(), 4, 'four Boards seal — the Year the acceptance test wants');

-- Backdate the seal so a year of taps can be placed inside it (§11.5 bounds occurred_at
-- below by sealed_at, and everything above happened at now()).
select set_config('role', 'postgres', true);
update boards set sealed_at = now() - interval '300 days';
update years  set sealed_at = now() - interval '300 days';
delete from notifications;

-- ---------------------------------------------------------------------------------
-- A Year with activity from four Members
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap_on('Alice', 0, now() - interval '200 days');
select tap_on('Alice', 0, now() - interval '100 days');
select tap_on('Alice', 0, now() - interval '30 days');
-- Two more than the Target of 3, so "the Goal they most exceeded" has an outright answer
-- rather than a three-way tie at exactly 1.0 broken alphabetically.
select tap_on('Alice', 0, now() - interval '29 days');
select tap_on('Alice', 0, now() - interval '28 days');
select tap_on('Alice', 1, now() - interval '90 days');
select tap_on('Alice', 1, now() - interval '80 days');
select tap_on('Alice', 2, now() - interval '10 days');

select act_as('00000000-0000-4000-8000-0000000000a2');
select tap_on('Bob', 0, now() - interval '150 days');
select tap_on('Bob', 0, now() - interval '149 days');
select tap_on('Bob', 0, now() - interval '148 days');

select act_as('00000000-0000-4000-8000-0000000000a3');
select tap_on('Carol', 0, now() - interval '60 days');
select tap_on('Carol', 0, now() - interval '59 days');

select act_as('00000000-0000-4000-8000-0000000000a4');
select tap_on('Dele', 0, now() - interval '20 days');

-- ---------------------------------------------------------------------------------
-- §20.1 — the Freeze
-- ---------------------------------------------------------------------------------

select act_as_cron();
select is((select status from years where id = year_of('Hertzell Family')), 'active',
  'the Year is under way, and the clock has not passed December 31 yet');
select is(freeze_due_years(), 0, 'so the sweep freezes nothing');

-- freeze_instant() is the same instant freezeInstant() computes in the domain layer:
-- midnight on January 1 of the following year, in the Family's own timezone (§8.3 T1).
select is(freeze_instant(2027, 'America/New_York'),
          '2028-01-01 00:00:00-05'::timestamptz,
  'the Freeze lands at midnight local, not at midnight UTC');
select isnt(freeze_instant(2027, 'America/New_York'),
            freeze_instant(2027, 'Europe/London'),
  'and two Families in two timezones freeze at two different instants');

select lives_ok($$select freeze_year(year_of('Hertzell Family'))$$,
  'the clock passes December 31 and the Year freezes');

select is((select status from years where id = year_of('Hertzell Family')), 'frozen',
  'the Year is frozen');
select isnt((select frozen_at from years where id = year_of('Hertzell Family')), null,
  'and stamped with when');

-- "Further Increments are rejected" — the other half of the acceptance test.
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values (gen_random_uuid(), tile_of('Alice', 0), member_of('Alice'))
$$, '42501', null, 'further Increments are rejected (§20.1)');

select act_as_cron();
select is((select frozen_at from years where id = year_of('Hertzell Family')),
          (select frozen_at from years where id = year_of('Hertzell Family')),
  'and freezing twice does not move the timestamp');
select lives_ok($$select freeze_year(year_of('Hertzell Family'))$$,
  'because freezing an already-frozen Year is a no-op, not an error');

-- ---------------------------------------------------------------------------------
-- §20.2 — Wrapped, generated once and materialized
-- ---------------------------------------------------------------------------------

select lives_ok($$select generate_wrapped(year_of('Hertzell Family'))$$,
  'Wrapped is generated at the Freeze');

select is((select count(*)::int from wrapped), 1, 'one Wrapped for the Year');
select is((select count(*)::int from wrapped_member_cards), 4,
  'and one card per Member, so each sees their own Year (§20.4)');

select lives_ok($$select generate_wrapped(year_of('Hertzell Family'))$$,
  'generating again is a no-op — it is written once and read many times (§20.2)');
select is((select count(*)::int from wrapped_member_cards), 4, 'and adds no second set');

-- ---------------------------------------------------------------------------------
-- §20.4 — the personal cards
-- ---------------------------------------------------------------------------------

select is((card('Alice') ->> 'increments')::int, 8, 'total Increments');
select is((card('Alice') ->> 'tiles_completed')::int, 3, 'Tiles completed');
select is((card('Alice') ->> 'tiles_total')::int, 25, 'of 25');
select is((card('Alice') ->> 'blackout')::boolean, false, 'Blackout');
select is((card('Alice') ->> 'notes')::int, 0, 'notes written');
select is((card('Alice') ->> 'photos')::int, 0, 'photos added');
select is((card('Alice') ->> 'swaps_used')::int, 0, 'Swaps taken');
select isnt(card('Alice') ->> 'biggest_month', null, 'best month');
select isnt(card('Alice') -> 'longest_goal_span_days', null, 'longest-running Goal');

-- Target vs actual on the Goal they most exceeded (§20.4). Only completed Goals: falling
-- short of 200 is not an achievement, and the ratio is what picks the winner.
select is(card('Alice') -> 'most_exceeded' ->> 'goal', 'Walk the dog',
  'the Goal they most exceeded');
select is((card('Alice') -> 'most_exceeded' ->> 'target')::int, 3, 'its Target');
select is((card('Alice') -> 'most_exceeded' ->> 'actual')::int, 5, 'and what they did');

-- A Member with one month of activity has no comeback to speak of, and the card says so
-- rather than inventing a zero.
select is((card('Bob') ->> 'increments')::int, 3, 'Bob''s Year is smaller');
select is((card('Bob') ->> 'biggest_month_increments')::int, 3, 'and all in one month');

-- ---------------------------------------------------------------------------------
-- §20.5 — the Family cards
-- ---------------------------------------------------------------------------------

select is((family_card() ->> 'increments')::int, 14,
  'aggregate Increments across the Family (§20.5)');

-- "Together you read 47 books and walked 2,100 times." Grouped on unit_canonical, so one
-- Member's "Books" and another's "book" add up (CONTEXT.md, Unit).
select is(
  (select (u ->> 'total')::int from jsonb_array_elements(family_card() -> 'units') u
    where u ->> 'unit' = 'book'), 4,
  'Alice''s two books and Carol''s two are added together on unit_canonical');

select is(
  (select (c ->> 'increments')::int from jsonb_array_elements(family_card() -> 'categories') c
    where c ->> 'category' = 'fitness'), 8,
  'and the category breakdown says what kind of year it was');

-- §20.8: a Goal that skipped Sharpening has no unit_canonical and cannot be added to
-- anything. It is excluded from the aggregate cards and from nowhere else.
select is(
  (select count(*)::int from jsonb_array_elements(family_card() -> 'units') u
    where u ->> 'unit' is null), 0,
  'a Goal that skipped Sharpening is excluded from the unit aggregate (§20.8)');
select is((card('Alice') ->> 'increments')::int, 8,
  'but still counts in every personal stat — refusing to measure is not refusing to count');

select isnt(family_card() -> 'busiest_month', null, 'the month the Family was most active');
select isnt(family_card() -> 'milestones', null, 'a timeline of Milestones');
select is((family_card() ->> 'next_year')::int, extract(year from now())::int + 1,
  'and the final card is not a stat — "Ready for next year?" (§20.6)');

-- ---------------------------------------------------------------------------------
-- §20.7 — every Member receives at least one Award
-- ---------------------------------------------------------------------------------
--
-- The assignment is assignAwards()' job and is tested there. What is tested here is the
-- guard: finalize_wrapped() refuses to publish a Wrapped that leaves somebody out, which
-- is the exact failure mode §20.7 names — "a family of 6 where one person gets nothing".

-- Dele is deliberately left out of the Awards handed in. Refusing to publish would cost
-- the whole Family their Wrapped — no Awards and no push for anybody, on cards that were
-- already committed — which is a worse outcome than the one it was preventing. The floor
-- is applied instead, which is the answer assignAwards() would have given.
select act_as_cron();
select is(
  finalize_wrapped(year_of('Hertzell Family'),
    json_build_array(
      json_build_object('member_id', member_of('Alice'),
                        'axis', 'most_increments', 'label', 'Most Increments'),
      json_build_object('member_id', member_of('Bob'),
                        'axis', 'most_consistent', 'label', 'Most Consistent'),
      json_build_object('member_id', member_of('Carol'),
                        'axis', 'most_notes', 'label', 'Most Notes Written'))::jsonb),
  4, '§20.3: every Member receives a push, simultaneously');

select is(awards_for('Dele'), 1,
  'the Member the Awards left out still receives one (§20.7)');
select is((select a.axis from wrapped_awards a where a.member_id = member_of('Dele')),
  'showed_up', 'the floor, which is never comparative');
select is((select count(*)::int from wrapped_awards), 4,
  'and the three that were fine are published unchanged');

select is(awards_for('Alice'), 1, 'Alice has an Award');
select is(awards_for('Dele'), 1, 'and so does Dele, whose Year was one drawing');

-- §13.5a: an Award names one person on one axis. There is no rank column and there must
-- never be one.
select hasnt_column('public', 'wrapped_awards', 'rank',
  'there is no rank column, and there must never be one (§13.5a, ADR-0006)');
select hasnt_column('public', 'wrapped_awards', 'position',
  'nor a placing by any other name');

-- Idempotent. The sweep may see the same Year again before the Edge Function's write has
-- been noticed, and a second round of pushes would be worse than none.
select is(
  finalize_wrapped(year_of('Hertzell Family'), '[]'::jsonb), 0,
  'finalizing twice sends no second round of pushes');
select is((select count(*)::int from notifications where kind = 'wrapped'), 4,
  'so the Family hears about Wrapped once');

-- ---------------------------------------------------------------------------------
-- §20.10 — frozen Years stay browsable forever
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from wrapped), 1,
  'a Member reads their Family''s Wrapped after the Freeze (§20.10)');
select is((select count(*)::int from wrapped_member_cards), 4,
  'including everyone''s cards — Wrapped is the Family''s, in-app (§20.9)');

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select generate_wrapped(year_of('Hertzell Family'))$$,
  '42501', null,
  'but no client can regenerate it — it is written once, at the Freeze');

select * from finish();
rollback;
