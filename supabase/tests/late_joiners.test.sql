-- Slice 21, server half: Late joiners.
--
-- Acceptance test (PRD §21):
--   Given a Family with a sealed, active Year
--   When a new Member is approved in July
--   Then they get a Board with a 7-day personal Setup Window, inherit the already-
--   decided Center Tile, and play through December 31
--
-- §21.5 says "no proration, no special-casing", and this file is mostly a demonstration
-- that none was needed: a July joiner gets 25 Tiles and the rest of the year, and every
-- other slice already works on them unchanged. That only holds because §13.5 removed
-- ranking — there is no standing to be behind in.

begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

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

create or replace function board_of(name text) returns boards
language sql stable as $$ select b.* from boards b where b.member_id = member_of(name) $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a4', 'dele@example.test',  '{"full_name":"Dele"}'::jsonb);

-- A Family whose Year is under way, with a shared Centre the Family voted for months ago.
select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
-- The CURRENT calendar year, because §21.3 is about a Year that is under way. A Year
-- still in the future has all of itself remaining, which is a different assertion.
select open_year(family_named('Hertzell Family'),
                 extract(year from now())::int);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks');

select set_config('role', 'postgres', true);
insert into proposals (id, vote_id, member_id, text)
  select '00000000-0000-4000-8000-0000000000d1', v.id, member_of('Alice'),
         'Walk the Ridgeway together'
    from votes v where v.year_id = year_of('Hertzell Family') and v.kind = 'goal';
insert into ballots (vote_id, member_id, choice_mode)
  select v.id, member_of('Alice'), 'shared'
    from votes v where v.year_id = year_of('Hertzell Family') and v.kind = 'mode';
insert into ballots (vote_id, member_id, proposal_id)
  select v.id, member_of('Alice'), '00000000-0000-4000-8000-0000000000d1'
    from votes v where v.year_id = year_of('Hertzell Family') and v.kind = 'goal';
update years set setup_deadline = now() - interval '1 minute'
 where family_id = family_named('Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Hertzell Family');

select act_as_cron();



select is(seal_due_boards(), 2, 'the Year seals in January with two Members');
select is((select center_mode from years where id = year_of('Hertzell Family')), 'shared',
  'and a shared Centre the Family voted for');

-- ---------------------------------------------------------------------------------
-- Approved in July
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a3', 'Carol', 'member', 'pending');

select is((select count(*)::int from boards b where b.member_id = member_of('Carol')), 0,
  'a pending Member gets no Board — they can read nothing, so it would only confuse (§3.2)');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select approve_member(member_of('Carol'))$$,
  'the Organizer approves her in July');

select act_as_cron();
select is((select count(*)::int from boards b where b.member_id = member_of('Carol')), 1,
  'she gets a Board');
select is((select count(*)::int from tiles t join boards b on b.id = t.board_id
            where b.member_id = member_of('Carol')), 25,
  'with 25 Tiles — no proration, no special-casing (§21.5)');

-- §21.1
select isnt((board_of('Carol')).personal_setup_deadline, null,
  'and a personal Setup Window (§21.1)');
select ok(
  (board_of('Carol')).personal_setup_deadline between now() + interval '6 days'
                                                 and now() + interval '8 days',
  'of seven days from approval');
select is((board_of('Carol')).sealed_at, null,
  'her Board is a draft, so she can author freely inside it');

-- §21.4
select isnt((board_of('Carol')).joined_late_at, null,
  'the Board carries a "joined July" marker so the Feed makes sense (§21.4)');

-- Everyone else's Board is untouched. This is the half of §21.2 that matters most.
select is((select count(*)::int from boards b
            where b.year_id = year_of('Hertzell Family') and b.joined_late_at is not null), 1,
  'and nobody else''s Board is marked');
select isnt((board_of('Alice')).sealed_at, null,
  'Alice''s Board is still sealed');

-- ---------------------------------------------------------------------------------
-- §21.2 — she inherits the Centre, and the Vote is not reopened
-- ---------------------------------------------------------------------------------

select is(
  (select t.family_goal_id from tiles t
    where t.board_id = (board_of('Carol')).id and t.position = 12),
  (select fg.id from family_goals fg where fg.year_id = year_of('Hertzell Family')),
  'her Center Tile is the Family Goal decided months ago (§21.2)');

select is(
  (select count(*)::int from votes v
    where v.year_id = year_of('Hertzell Family') and v.status <> 'resolved'), 0,
  'the Center Vote is NOT reopened — that would alter a Tile on every sealed Board');

select is((select count(*)::int from ballots b
            where b.member_id = member_of('Carol')), 0,
  'she casts no Ballot, because there is nothing left to vote on');

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select write_goal(tile_of('Carol', 12), 'My own centre', 5)$$,
  'PT403', null,
  'and she cannot author over it — the Centre belongs to the Family (§6.5)');

-- ---------------------------------------------------------------------------------
-- She authors the other 24, inside her own window
-- ---------------------------------------------------------------------------------

select lives_ok(
  $$select write_goal(tile_of('Carol', 0), 'Swim the Serpentine', 20, 'swims')$$,
  'she writes her own Goals while her window is open');

select is((select g.target from goals g join tiles t on t.goal_id = g.id
            where t.id = tile_of('Carol', 0)), 20, 'and they land on her Board');

-- §21.3: Sharpening is handed the remaining fraction so a July joiner is offered ~70
-- walks rather than 300 (§7.7). Computed on the server, because it decides what Targets
-- get proposed and a client that got it wrong would quietly hand someone a Board they
-- cannot finish.
select ok(remaining_year_fraction(year_of('Hertzell Family')) between 0 and 1,
  'the remaining fraction of the Year is a fraction (§21.3)');
select ok(remaining_year_fraction(year_of('Hertzell Family')) < 1,
  'and less than a whole Year, because the Year is under way');

-- She cannot log yet: her Board is still a draft, and that is the same rule everyone
-- played by in December.
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values (gen_random_uuid(), tile_of('Carol', 0), member_of('Carol'))
$$, '42501', null, 'and she plays once her window closes, not before (§11.5)');

-- ---------------------------------------------------------------------------------
-- §21.1 — the window closes on her own clock
-- ---------------------------------------------------------------------------------

select act_as_cron();
select is(seal_due_boards(), 0, 'the sweep leaves her alone while her window is open');

select set_config('role', 'postgres', true);
update boards set personal_setup_deadline = now() - interval '1 minute'
 where member_id = member_of('Carol');

select act_as_cron();
select is(seal_due_boards(), 1,
  'and seals her Board when it runs out — on her clock, not the Family''s (§21.1)');
select isnt((board_of('Carol')).sealed_at, null, 'her Board is sealed');

select act_as('00000000-0000-4000-8000-0000000000a3');
select lives_ok($$
  insert into increments (id, tile_id, member_id)
  values (gen_random_uuid(), tile_of('Carol', 0), member_of('Carol'))
$$, 'and she plays through December 31 like everyone else');

-- ---------------------------------------------------------------------------------
-- The hole slice 12 left open, and named
-- ---------------------------------------------------------------------------------
--
-- complete_family_goal() matches Tile 12 on family_goal_id, so a Member whose Board was
-- dealt after the seal used to be silently skipped when the Family finished its shared
-- Goal. Slice 12 could not fix it: nothing wrote that column at approval time, because
-- nothing dealt the Board.

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$select complete_family_goal(year_of('Hertzell Family'), member_of('Alice'))$$,
  'the Family walks the Ridgeway together');

select act_as_cron();
select is((select count(*)::int from milestones m
            where m.year_id = year_of('Hertzell Family') and m.type = 'tile_completed'
              and m.member_id = member_of('Carol')), 1,
  'and Carol''s Centre completes with everyone else''s — the §12.3 hole is closed');

-- §15.5, and the case that made the rule insufficient as written. Alice marked it done;
-- every OTHER Board's Tile 12 completes with a different subject, and excluding only the
-- subject's own Account left Alice being pushed N-1 times about a Milestone her own thumb
-- caused. The actor is auth.uid(), and it is excluded everywhere.
select is((select count(*)::int from notifications n
            where n.kind = 'tile_completed'
              and n.account_id = '00000000-0000-4000-8000-0000000000a1'), 0,
  'and the Member who marked it done is pushed none of it (§15.5)');
select cmp_ok((select count(*)::int from notifications n
                where n.kind = 'tile_completed'), '>', 0,
  'while the rest of the Family is told');

select is((select count(*)::int from milestones m
            where m.year_id = year_of('Hertzell Family') and m.type = 'tile_completed'), 3,
  'one Milestone each, across all three Members');

-- ---------------------------------------------------------------------------------
-- A Member who arrives when the Centre is already done
-- ---------------------------------------------------------------------------------
--
-- Their Tile 12 is the same Tile everyone else has, so it cannot read differently on
-- their Board.

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a4', 'Dele', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select approve_member(member_of('Dele'))$$,
  'Dele is approved after the Family Goal is already finished');

select act_as_cron();
select is(
  (select t.family_goal_id from tiles t
    where t.board_id = (board_of('Dele')).id and t.position = 12),
  (select fg.id from family_goals fg where fg.year_id = year_of('Hertzell Family')),
  'he inherits the same Centre');
select is((select count(*)::int from milestones m
            where m.member_id = member_of('Dele') and m.type = 'tile_completed'), 1,
  'and it arrives complete, because for the Family it is');

-- ---------------------------------------------------------------------------------
-- Nobody else becomes a late joiner
-- ---------------------------------------------------------------------------------
--
-- A Member approved during the Setup Window is not a late joiner at all: they seal with
-- everyone else on the Family's clock, and giving them a personal window would let them
-- author for a week after the Family's Boards had already been committed.

select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');
select open_year(family_named('Okonkwo Family'), extract(year from now())::int + 1);

-- A Year that has not begun has all of itself left, so authoring during the Setup Window
-- proposes full-year Targets (§7.7). The clamp is what makes that true.
select is(remaining_year_fraction(year_of('Okonkwo Family')), 1::numeric,
  'a Year still ahead of the Family has all of itself remaining');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Okonkwo Family'), '00000000-0000-4000-8000-0000000000a4', 'Eze', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000a3');
select lives_ok($$select approve_member(member_of('Eze'))$$,
  'a Member approved during the Setup Window is approved normally');

select act_as_cron();
select is((select count(*)::int from boards b
            where b.member_id = member_of('Eze') and b.joined_late_at is not null), 0,
  'and is not marked as a late joiner (§21.1 is about a Year already under way)');

-- A frozen Year deals nobody a Board. There is nothing left to play.
select set_config('role', 'postgres', true);
update years set frozen_at = now(), status = 'frozen' where id = year_of('Hertzell Family');
insert into members (id, family_id, account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e9', family_named('Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a2', 'Frankie', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select approve_member('00000000-0000-4000-8000-0000000000e9')$$,
  'someone approved into a Family whose Year has frozen is still approved');

select act_as_cron();
select is((select count(*)::int from boards b
            where b.member_id = '00000000-0000-4000-8000-0000000000e9'), 0,
  'but gets no Board — a frozen Year is permanent history, not somewhere to start (§20.1)');

-- ---------------------------------------------------------------------------------
-- §21.3 — the SQL copy agrees with the TypeScript one
-- ---------------------------------------------------------------------------------
--
-- schema.md §5: where a computation exists in both languages, a test asserting the same
-- value on both sides is the only thing holding them together. These are the fixtures
-- from remainingYearFraction's own tests in src/domain/setup-window.test.ts, to the
-- instant, so the two files fail together or not at all.

select act_as_cron();
insert into families (id, name, timezone) values
  ('00000000-0000-4000-8000-0000000000fc', 'Parity Family', 'UTC');
insert into years (id, family_id, calendar_year, status, setup_deadline) values
  ('00000000-0000-4000-8000-0000000000fd', '00000000-0000-4000-8000-0000000000fc',
   2027, 'setup', '2027-01-01T00:00:00Z');

select is(
  remaining_year_fraction('00000000-0000-4000-8000-0000000000fd',
                          '2027-01-01T00:00:00Z'::timestamptz),
  1::numeric, 'is 1 at the very start of the Year');

select is(
  remaining_year_fraction('00000000-0000-4000-8000-0000000000fd',
                          '2026-12-01T00:00:00Z'::timestamptz),
  1::numeric, 'is 1 before the Year begins, so Setup Window targets are full-year');

select is(
  remaining_year_fraction('00000000-0000-4000-8000-0000000000fd',
                          '2028-01-01T00:00:00Z'::timestamptz),
  0::numeric, 'is 0 once the Year has ended');

select ok(
  remaining_year_fraction('00000000-0000-4000-8000-0000000000fd',
                          '2027-07-02T12:00:00Z'::timestamptz) between 0.49 and 0.51,
  'and is about half at the start of July — the same instant the TypeScript test uses');

select * from finish();
rollback;
