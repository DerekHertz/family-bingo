-- Slice 12, server half: Completing a Tile.
--
-- Acceptance test (PRD §12):
--   Given a Goal with target 3 and 2 Increments
--   When a third Increment is logged
--   Then the Tile is complete and a Milestone is recorded
--
-- Lines, Bingo and Blackout are slice 13. This slice emits `tile_completed` and nothing
-- else — milestonesToEmit() already derives the rest, and wiring it in is that slice's
-- job, not this one's.

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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

create or replace function progress_of(name text, pos int) returns int
language sql stable as $$
  select count(*)::int from increments i where i.tile_id = tile_of(name, pos)
$$;

-- Completions recorded for one Tile. The unique index makes "exactly one" the database's
-- job, but §12.2 is the requirement and it deserves an assertion of its own.
create or replace function completions_of(name text, pos int) returns int
language sql stable as $$
  select count(*)::int from milestones m
   where m.member_id = member_of(name)
     and m.tile_id = tile_of(name, pos)
     and m.type = 'tile_completed'
$$;

-- A tap, written the way the client writes one (api.md §8).
create or replace function tap(name text, pos int, id uuid) returns void
language sql as $$
  insert into increments (id, tile_id, member_id) values (id, tile_of(name, pos), member_of(name))
  on conflict (id) do nothing
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Hertzell Family');
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
                ('Alice', 0, 'Walk the dog')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

select is(seal_due_boards(), 2, 'both Boards seal and the Year is under way');

-- ---------------------------------------------------------------------------------
-- §12.1, §12.2 — the acceptance test
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c2');

select is(progress_of('Alice', 0), 2, 'two Increments against a Target of 3');
select is(completions_of('Alice', 0), 0, 'two of three is not a completed Tile');

select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c3');

select is(progress_of('Alice', 0), 3, 'the third Increment lands');
select is(completions_of('Alice', 0), 1,
  'and the Tile completes, recording exactly one Milestone (§12.2)');

select is(
  (select m.type from milestones m where m.tile_id = tile_of('Alice', 0)),
  'tile_completed', 'of type tile_completed');

select is(
  (select m.year_id from milestones m where m.tile_id = tile_of('Alice', 0)),
  year_of('Hertzell Family'), 'stamped with the Year it belongs to');

-- §12.2: past the Target nothing further fires. Overshoot is celebrated once, in
-- Wrapped (§20.4) — never as a second interruption.
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c4');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c5');

select is(progress_of('Alice', 0), 5, 'Increments past the Target still count');
select is(completions_of('Alice', 0), 1,
  'but record no second Milestone — the Family is told once (§12.2)');

-- §12.1: derived, never stored. A cached flag and an append-only log will drift, and
-- the log is the source of truth (§11.4, schema.md §3.1).
select hasnt_column('public', 'tiles', 'completed_at',
  'completion is derived from COUNT(increments) >= target, never stored on the Tile');
select hasnt_column('public', 'tiles', 'is_complete',
  'not as a flag either');

-- ---------------------------------------------------------------------------------
-- A Milestone is an event, and events do not un-happen
-- ---------------------------------------------------------------------------------
--
-- Deleting an Increment is the one mutation §11.3 permits, and it can drop a Tile back
-- below its Target. The Milestone stands: it was pushed to the Family's phones and
-- cannot be unsent, and milestonesToEmit() treats the recorded row as the thing that
-- stops a second notification. Withdrawing it would re-arm the interruption.

select lives_ok($$
  delete from increments where id in ('00000000-0000-4000-8000-0000000000c4',
                                      '00000000-0000-4000-8000-0000000000c5',
                                      '00000000-0000-4000-8000-0000000000c3')
$$, 'a Member deletes three Increments, dropping back below the Target');

select is(progress_of('Alice', 0), 2, 'progress follows the log back down (§12.1)');
select is(completions_of('Alice', 0), 1,
  'but the Milestone stands — it was pushed to phones and cannot be unsent');

select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c6');
select is(completions_of('Alice', 0), 1,
  'and re-crossing the Target does not tell the Family a second time');

-- ---------------------------------------------------------------------------------
-- A Bingo is a social claim, so it must not be forgeable
-- ---------------------------------------------------------------------------------

select throws_ok($$
  insert into milestones (member_id, year_id, type, tile_id)
  values (member_of('Alice'), year_of('Hertzell Family'), 'blackout', null)
$$, '42501', null,
  'a client cannot write its own Milestone — there is no INSERT grant, by design');

-- ---------------------------------------------------------------------------------
-- §12.3 — the Family Goal completes for everyone at once
-- ---------------------------------------------------------------------------------

-- A personal-mode Year has no Family Goal at all, so there is nothing to mark.
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select complete_family_goal(year_of('Hertzell Family'), member_of('Alice'))$$,
  'PT403', null,
  'a personal-mode Year has no Family Goal to complete (§9.3)');

select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');

select set_config('role', 'postgres', true);
insert into members (family_id, guardian_account_id, display_name, role, status)
  values ((select id from families where name = 'Okonkwo Family'),
          '00000000-0000-4000-8000-0000000000a3', 'Chidi', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a3');
select open_year((select id from families where name = 'Okonkwo Family'), 2028);

select set_config('role', 'postgres', true);
insert into proposals (id, vote_id, member_id, text)
  select '00000000-0000-4000-8000-0000000000d1', v.id, member_of('Chidi'),
         'Walk the Ridgeway together'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'goal';
insert into ballots (vote_id, member_id, choice_mode)
  select v.id, member_of('Chidi'), 'shared'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'mode';
insert into ballots (vote_id, member_id, proposal_id)
  select v.id, member_of('Chidi'), '00000000-0000-4000-8000-0000000000d1'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'goal';

update years set setup_deadline = now() - interval '1 minute'
 where id = year_of('Okonkwo Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Okonkwo Family');

-- Resolution alone is not the seal. resolve_center_vote() is Organizer-callable and
-- stamps family_goal_id onto every Tile 12, opening a window in which a Family Goal sits
-- on Boards that are still drafts. Every Increment path is shut then; so is this one.
select act_as('00000000-0000-4000-8000-0000000000a3');
select lives_ok($$select resolve_center_vote(year_of('Okonkwo Family'))$$,
  'the Organizer resolves the Center Vote before the sweep gets there');
select throws_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Chidi'))$$,
  'PT403', null,
  'but the Family Goal cannot be completed before the Boards seal (§11.5)');

select act_as_cron();
select is(seal_due_boards(), 2, 'the shared-mode Family seals, Family Goal on every Tile 12');

-- Chidi is a Managed Member; Carol is his Guardian and acts as him. Any Member may mark
-- it — the Family Goal belongs to the Family, not to whoever proposed it.
select act_as('00000000-0000-4000-8000-0000000000a3');
select lives_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Chidi'))$$,
  'any Member may mark the Family Goal done (§12.3)');

select isnt((select fg.completed_at from family_goals fg
              where fg.year_id = year_of('Okonkwo Family')), null,
  'the Family Goal is done');

select is((select fg.completed_by_member_id from family_goals fg
            where fg.year_id = year_of('Okonkwo Family')),
  member_of('Chidi'),
  'and the Feed records who did it — attributed to the Managed Member, not the Guardian (§4.2)');

select is(
  (select count(*)::int from milestones m
    where m.year_id = year_of('Okonkwo Family') and m.type = 'tile_completed'),
  2,
  'every Member''s Tile 12 completes simultaneously — one Milestone each (§12.3)');

-- Idempotent. Two Members tapping "done" within a second of each other must not double
-- the Feed, nor move the timestamp the first one set.
select act_as('00000000-0000-4000-8000-0000000000a3');
select lives_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Chidi'))$$,
  'marking it done twice is a no-op, not an error');

select is(
  (select count(*)::int from milestones m
    where m.year_id = year_of('Okonkwo Family') and m.type = 'tile_completed'),
  2, 'and records no second round of Milestones');

-- The Family boundary holds here as everywhere (ADR-0004).
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Alice'))$$,
  '42501', null,
  'CROSS-FAMILY: alice cannot complete another Family''s Family Goal');

-- SELF-ONLY: and she cannot act as a Member she does not control, even to do something
-- any Member of that Family is allowed to do.
select throws_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Chidi'))$$,
  '42501', null,
  'SELF-ONLY: alice cannot mark it as Chidi');

-- A frozen Year is permanent family history — progress can no longer be recorded (§20.1).
select set_config('role', 'postgres', true);
update years set frozen_at = now() where id = year_of('Okonkwo Family');
insert into family_goals (year_id, text)
  select year_of('Hertzell Family'), 'A centre this Family never voted for'
   where not exists (select 1 from family_goals where year_id = year_of('Hertzell Family'));
update years set frozen_at = now() where id = year_of('Hertzell Family');

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select complete_family_goal(year_of('Hertzell Family'), member_of('Alice'))$$,
  '42501', null,
  'a frozen Year is read-only — its Family Goal can no longer be marked (§20.1)');

select * from finish();
rollback;
