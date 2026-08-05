-- Slice 19, server half: the Weekly Digest.
--
-- Acceptance test (PRD §19):
--   Given a Family with a week of activity and a Member opted in
--   When the weekly job runs
--   Then that Member receives one summary push and no others receive it
--
-- Two of the three requirements are about NOT sending: opt-in default off (§19.1), and
-- never an empty digest (§19.3). Most of this file is therefore about silence, which is
-- the same shape as slice 15 and for the same reason — this is the second push in an app
-- whose whole notification budget is about one every two days (api.md §6).

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

create or replace function digests_for(account uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications n
   where n.account_id = account and n.kind = 'digest'
$$;

create or replace function tap(name text, pos int, id uuid) returns void
language sql as $$
  insert into increments (id, tile_id, member_id) values (id, tile_of(name, pos), member_of(name))
  on conflict (id) do nothing
$$;

-- The week the job is about: the seven days ending now. The end is exclusive and every
-- row in this file is written at the transaction's now(), so the window has to reach just
-- past it or it would contain nothing.
create or replace function this_week() returns timestamptz
language sql stable as $$ select now() - interval '7 days' $$;

create or replace function week_end() returns timestamptz
language sql stable as $$ select now() + interval '1 minute' $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active'),
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a3', 'Carol', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year(family_named('Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks');
select write_goal(tile_of('Alice', 1), 'One', 1);
select write_goal(tile_of('Alice', 2), 'Two', 1);
select write_goal(tile_of('Alice', 3), 'Three', 1);
select write_goal(tile_of('Alice', 4), 'Four', 1);
-- The rest of Alice's Board, so a Line has Tiles to pass through.
--
-- Before the deal, "write five Goals to positions 0-4" put five Goals on row 0. It does
-- not any more (§4.1) — they land wherever the shuffle sends them — so a Line assertion
-- against a partly-authored Board depends on luck, and was flaky exactly that way.
do $author$
declare p int;
begin
  for p in 0..24 loop
    if p <> 12 and (select goal_id from tiles t join boards b on b.id = t.board_id
                     where b.member_id = member_of('Alice') and t.position = p) is null then
      perform write_goal(
        (select t.id from tiles t join boards b on b.id = t.board_id
          where b.member_id = member_of('Alice') and t.position = p),
        'Filler ' || p, 1);
    end if;
  end loop;
end $author$;


-- Bob authors one Tile and leaves the other 24 empty, which is what §10.2 permits and
-- what the "near a Line" nudge has to be careful about further down.
select act_as('00000000-0000-4000-8000-0000000000a2');
select write_goal(tile_of('Bob', 0), 'Swim', 5, 'swims');


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
                ('Alice', 1, 'One'),
                ('Alice', 2, 'Two'),
                ('Alice', 3, 'Three'),
                ('Alice', 4, 'Four'),
                ('Bob', 0, 'Swim')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

-- The squares are dealt at seal (§4.1), so "the Tile at position N" and "the Tile holding
-- the Goal I wrote at N" are two different things now. tile_of() above answers the second,
-- which is what every progress assertion means. **Lines are the exception**: §13.1 pays out
-- on squares, so a Line test has to say squares.
create or replace function tile_at(name text, pos int) returns uuid
language sql stable as $at$
  select t.id from tiles t
    join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$at$;

-- Complete whatever Goal now sits on a square, by logging its own Target.
create or replace function finish_at(name text, pos int) returns void
language plpgsql as $fin$
declare n int; tgt int;
begin
  select g.target into tgt
    from tiles t join goals g on g.id = t.goal_id
   where t.id = tile_at(name, pos);
  for n in 1..tgt loop
    insert into increments (id, tile_id, member_id)
    values (gen_random_uuid(), tile_at(name, pos), member_of(name));
  end loop;
end;
$fin$;


select is(seal_due_boards(), 3, 'three Boards seal and the Year is under way');
delete from notifications;

-- ---------------------------------------------------------------------------------
-- §19.3 — a week with nothing in it
-- ---------------------------------------------------------------------------------
--
-- Checked first, before anyone's preference is consulted, because "never send an empty
-- digest" outranks "this Member asked for digests". A weekly reminder that nothing
-- happened is a weekly reminder to uninstall.

select set_config('role', 'postgres', true);
update members set digest_opt_in = true where display_name = 'Alice';

-- A window genuinely before anything happened. The Family's own founding — Members
-- arriving, the Center Vote resolving — is activity, and lands in the current week; a
-- test that used this week for "nothing happened" would be asserting against a week that
-- was not empty.
select act_as_cron();
select is(build_and_send_digest(year_of('Hertzell Family'),
                                now() - interval '21 days', now() - interval '14 days'), 0,
  'a week with no activity sends nothing at all (§19.3)');
select is((select count(*)::int from digests), 0,
  'and builds no Digest to send — the row is not created either');

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c1');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c2');
select tap('Alice', 0, '00000000-0000-4000-8000-0000000000c3');

select act_as('00000000-0000-4000-8000-0000000000a2');
select tap('Bob', 0, '00000000-0000-4000-8000-0000000000c4');

select act_as_cron();
delete from notifications;

select is(build_and_send_digest(year_of('Hertzell Family'), this_week(), week_end()), 1,
  'a week of activity and one Member opted in: one summary push');

select is(digests_for('00000000-0000-4000-8000-0000000000a1'), 1,
  'the Member who asked for it receives it');
select is(digests_for('00000000-0000-4000-8000-0000000000a2'), 0,
  'and no others receive it (§19.1 — opt-in, default off)');
select is(digests_for('00000000-0000-4000-8000-0000000000a3'), 0,
  'not even the third Member, who never said anything either way');

-- ---------------------------------------------------------------------------------
-- §19.2 — what is in it
-- ---------------------------------------------------------------------------------

select is((select count(*)::int from digests), 1, 'one Digest, for the Family, not per Member');

select is((select d.increment_count from digests d), 4,
  'the Family''s activity count for the week (§19.2)');

select is((select d.milestone_count from digests d), 1,
  'and the Milestones in it — Alice''s Tile completed');

select is((select jsonb_array_length(d.notable) from digests d), 1,
  'named, so the push can say what happened rather than how much');
select is((select d.notable -> 0 ->> 'member' from digests d), 'Alice',
  'who did it');
select is((select d.notable -> 0 ->> 'goal' from digests d), 'Walk the dog',
  'and what they were doing');

-- The Digest is built once and belongs to the Family, so two Members cannot be sent
-- summaries that disagree.
select is((select d.family_id from digests d), family_named('Hertzell Family'),
  'the Digest is the Family''s week, computed once');

-- ---------------------------------------------------------------------------------
-- §19.2 — Members near a Line
-- ---------------------------------------------------------------------------------
--
-- Four of five. The one state where a nudge is worth something and where nothing else in
-- the app says anything: the Board shows a Line closed or not closed, and only this
-- notices "one Tile away".

select is((select jsonb_array_length(d.near_line) from digests d), 0,
  'nobody is near a Line yet');

select act_as('00000000-0000-4000-8000-0000000000a1');
-- By square, not by Goal: "near a Line" is a positional fact (§13.1), and row 0 is row 0
-- whichever Goals the deal put on it.
select finish_at('Alice', 0);
select finish_at('Alice', 1);
select finish_at('Alice', 2);
select finish_at('Alice', 3);

select act_as_cron();
select is((select count(*)::int from members_near_a_line(year_of('Hertzell Family'))), 1,
  'Alice completes Tiles 0-3 and is one Tile from row 0');
select is((select n.line_index from members_near_a_line(year_of('Hertzell Family')) n), 0,
  'the Line she is near is row 0');
select is((select n.missing_position from members_near_a_line(year_of('Hertzell Family')) n), 4,
  'and the Tile she is short of is position 4');

-- Closing it takes her off the list — she is no longer NEAR a Line, she has one.
select act_as('00000000-0000-4000-8000-0000000000a1');
select finish_at('Alice', 4);

select act_as_cron();
select is((select count(*)::int from members_near_a_line(year_of('Hertzell Family'))), 0,
  'closing it takes her off the list — that is a Bingo, not a nudge');

-- An empty Tile on a Board that sealed unfinished is not a nudge either: it has no
-- Target, and telling someone they are one Tile from a Line they cannot close without
-- spending a Swap (§18.5) is a taunt rather than encouragement.
select act_as('00000000-0000-4000-8000-0000000000a2');
select tap('Bob', 0, '00000000-0000-4000-8000-0000000000e1');
select tap('Bob', 0, '00000000-0000-4000-8000-0000000000e2');
select tap('Bob', 0, '00000000-0000-4000-8000-0000000000e3');
select tap('Bob', 0, '00000000-0000-4000-8000-0000000000e4');

select act_as_cron();
select is((select count(*)::int from members_near_a_line(year_of('Hertzell Family'))
            where member_id = member_of('Bob')), 0,
  'Bob''s Board sealed with 24 empty Tiles, so he is near nothing he could finish');

-- ---------------------------------------------------------------------------------
-- §19.1 — weekly means weekly, however often the sweep runs
-- ---------------------------------------------------------------------------------
--
-- The sweep is hourly, because one weekly cron fires at one instant and that instant is
-- Sunday evening in at most one timezone (§8.3 T1). The unique index is what keeps hourly
-- from meaning hourly.

select act_as_cron();
select is(build_and_send_digest(year_of('Hertzell Family'), this_week(), week_end()), 0,
  'a second run of the same week sends nothing');
select is((select count(*)::int from digests), 1, 'and builds no second Digest');
select is(digests_for('00000000-0000-4000-8000-0000000000a1'), 1,
  'so the opted-in Member is pushed once, not once an hour');

-- A different week is a different Digest.
select is(build_and_send_digest(year_of('Hertzell Family'),
                                now() - interval '21 days', now() - interval '14 days'), 0,
  'a week before the Family existed still sends nothing');

-- ---------------------------------------------------------------------------------
-- §19.2, §19.3 — "activity" is the Feed, not just Increments
-- ---------------------------------------------------------------------------------
--
-- CONTEXT.md: a Digest is "a weekly summary of the Family's Feed", and the Feed is "every
-- Increment, Milestone, Swap, vote outcome and Member arriving". A week in which somebody
-- swapped a Goal and nothing else is exactly the week a quiet Family wants to hear about.

select set_config('role', 'postgres', true);
delete from digests;
delete from notifications;
create temporary table quiet_window (starts timestamptz, ends timestamptz);
insert into quiet_window
  values (now() - interval '40 days', now() - interval '33 days');

select act_as_cron();
select is(build_and_send_digest(year_of('Hertzell Family'),
                                (select starts from quiet_window),
                                (select ends from quiet_window)), 0,
  'a window with nothing in it sends nothing');

select set_config('role', 'postgres', true);
insert into revisions (board_id, tile_id, before_text, before_target,
                       after_text, after_target, created_at)
  select b.id, tile_of('Alice', 1), 'One', 1, 'One, differently', 1,
         (select starts from quiet_window) + interval '1 day'
    from boards b where b.member_id = member_of('Alice');

select act_as_cron();
select is(build_and_send_digest(year_of('Hertzell Family'),
                                (select starts from quiet_window),
                                (select ends from quiet_window)), 1,
  'but a week whose only news is a Swap is still news (§19.3)');

-- ---------------------------------------------------------------------------------
-- Opting out, and opting in
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
update members set digest_opt_in = true where display_name = 'Bob';
update members set digest_opt_in = false where display_name = 'Alice';
delete from digests;
delete from notifications;

select act_as_cron();
select is(build_and_send_digest(year_of('Hertzell Family'), this_week(), week_end()), 1,
  'the Family''s week has not changed, but who wants to hear about it has');
select is(digests_for('00000000-0000-4000-8000-0000000000a2'), 1, 'Bob now gets it');
select is(digests_for('00000000-0000-4000-8000-0000000000a1'), 0, 'and Alice no longer does');

-- ---------------------------------------------------------------------------------
-- A frozen Year says nothing
-- ---------------------------------------------------------------------------------
--
-- Wrapped is the story of a finished Year (§20), and a digest arriving after it would be
-- an anticlimax about a week in which nothing could have happened.

select set_config('role', 'postgres', true);
update years set frozen_at = now(), status = 'frozen'
 where id = year_of('Hertzell Family');

select act_as_cron();
select is(send_due_digests(), 0, 'the sweep skips a frozen Year');

-- ---------------------------------------------------------------------------------
-- The boundary
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from digests), 1,
  'a Member reads their own Family''s Digest — it is the Family''s week');

select act_as('00000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$select build_and_send_digest(year_of('Hertzell Family'), this_week(), week_end())$$,
  '42501', null,
  'and no client can make the app send a push to their Family');

select * from finish();
rollback;
