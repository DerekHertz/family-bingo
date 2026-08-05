-- Slice 14, server half: the Feed.
--
-- Acceptance test (PRD §14):
--   Given a Family with recent activity
--   When a Member opens the Feed
--   Then they see a reverse-chronological list of Increments (with notes), Milestones,
--   Swaps, and vote outcomes — for their Family only
--   And given an Account in a different Family queries the same endpoint
--   Then zero rows are returned
--
-- §14.3 is explicit that the second half is a pgTAP test and not a UI check, and that it
-- must assert ZERO ROWS rather than an error. That is the last third of this file.

begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

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


create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

-- SECURITY DEFINER, and only in this file. A cross-Family assertion that resolves the
-- other Family's id through the caller's own RLS gets NULL, and `family_id = NULL` is
-- never true — so the test would pass against a Feed that leaked everything. The id has
-- to come from outside the boundary for the assertion to be about the boundary.
-- Once a Family has two Years, year_of() is ambiguous. This one names which.
create or replace function year_num(family text, cal int) returns uuid
language sql stable security definer set search_path = public as $$
  select y.id from years y join families f on f.id = y.family_id
   where f.name = family and y.calendar_year = cal
$$;

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

-- What the caller can see, counted by kind. Every assertion below is from the point of
-- view of whoever is currently acting — that is the whole subject of this file.
create or replace function feed_count(of_kind text) returns int
language sql stable as $$
  select count(*)::int from feed f where f.kind = of_kind
$$;

create or replace function feed_total() returns int
language sql stable as $$ select count(*)::int from feed $$;

-- One page of the Feed as the client would ask for it, reduced to its kinds. Ordering is
-- the thing under test, so the page is numbered before it is cut and the array is built
-- from those numbers — an ORDER BY inside a subquery is not a promise array_agg has to
-- keep.
create or replace function feed_kinds(lim int, skip int) returns text[]
language sql stable as $$
  select array_agg(p.kind order by p.rn)
    from (select f.kind, row_number() over (order by f.created_at desc, f.id) as rn
            from feed f) p
   where p.rn > skip and p.rn <= skip + lim
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a4', 'dave@example.test',  '{"full_name":"Dave"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a5', 'erin@example.test',  '{"full_name":"Erin"}'::jsonb);

-- ---------------------------------------------------------------------------------
-- A Family with recent activity
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');
-- A Member who asked and has not yet been approved. They have not arrived, so they are
-- not in the Feed — and they cannot read it either (§3.2), asserted at the end.
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a4', 'Dave', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks');
select write_goal(tile_of('Alice', 1), 'Read a book', 2, 'books');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Hertzell Family');

select act_as_cron();
-- Two Boards, not three: a pending Member is dealt none, because they have not arrived.



select is(seal_due_boards(), 2, 'both active Members'' Boards seal and the Year is under way');

select act_as('00000000-0000-4000-8000-0000000000a1');
insert into increments (id, tile_id, member_id, note) values
  ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0), member_of('Alice'),
   'round the reservoir'),
  ('00000000-0000-4000-8000-0000000000c2', tile_of('Alice', 0), member_of('Alice'), null),
  ('00000000-0000-4000-8000-0000000000c3', tile_of('Alice', 0), member_of('Alice'),
   'the third one, which completes it');

-- {family_id}/{increment_id}, the layout the bucket was created with and the only shape
-- enforce_attachment_path() accepts (§16.2).
insert into attachments (increment_id, storage_path)
  values ('00000000-0000-4000-8000-0000000000c1',
          family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.jpg');

-- ---------------------------------------------------------------------------------
-- §14.2 — what the Feed contains
-- ---------------------------------------------------------------------------------

select is(feed_count('increment'), 3, 'every Increment is in the Feed (§14.2)');

select is(
  (select f.note from feed f where f.id = '00000000-0000-4000-8000-0000000000c1'),
  'round the reservoir', 'with its note');

select is(
  (select f.attachment_path from feed f
    where f.id = '00000000-0000-4000-8000-0000000000c1') is not null,
  true, 'and its Attachment (ADR-0005)');

select is(
  (select f.note from feed f where f.id = '00000000-0000-4000-8000-0000000000c2'),
  null, 'a bare Increment carries no note — logging is one tap (§11.1)');

select is(
  (select f.goal_text from feed f where f.id = '00000000-0000-4000-8000-0000000000c1'),
  'Walk the dog', 'the Goal is named, so the Feed reads without a second query');

select is(
  (select f.member_id from feed f where f.id = '00000000-0000-4000-8000-0000000000c1'),
  member_of('Alice'), 'attributed to the Member whose Board it is');

-- The third Increment completed the Tile, so a Milestone joined the Feed beside it.
select is(feed_count('milestone'), 1, 'the completed Tile is in the Feed (§14.2)');
select is(
  (select f.milestone_type from feed f where f.kind = 'milestone'),
  'tile_completed', 'as a tile_completed');
select is(
  (select f.goal_text from feed f where f.kind = 'milestone'),
  'Walk the dog', 'naming the Goal that closed');

-- Vote outcomes. Nobody cast a Ballot, so the mode fell back to personal (§8.3) and the
-- goal Vote resolved with no winner — which is not an outcome, and does not appear.
select is(feed_count('vote_resolved'), 1,
  'the mode Vote''s outcome is in the Feed');
select is(
  (select f.vote_outcome from feed f where f.kind = 'vote_resolved' and f.vote_kind = 'mode'),
  'personal', 'the mode Vote records what was voted (§9.3)');
select is(
  (select count(*)::int from feed f
    where f.kind = 'vote_resolved' and f.vote_kind = 'goal'), 0,
  'a goal Vote that produced no Family Goal has no outcome to report');

-- Members joining. Alice, Bob — and not Dave, who is still pending.
select is(feed_count('member_joined'), 2,
  'the two active Members joining are in the Feed; the pending one has not arrived');
select is(
  (select f.year_id from feed f
    where f.kind = 'member_joined' and f.member_id = member_of('Alice')),
  year_of('Hertzell Family'),
  'a founder joined before the Family had a Year, and lands in its first');

-- Swaps (§14.2, §18.4). swap_tile() is slice 18, so the Revision is written here the way
-- that slice will write it — the Feed branch is what is under test, not the RPC.
select set_config('role', 'postgres', true);
insert into revisions (board_id, tile_id, before_text, before_target, after_text, after_target)
  select b.id, tile_of('Alice', 1), 'Read a book', 2, 'Read a book', 1
    from boards b where b.member_id = member_of('Alice');

select act_as('00000000-0000-4000-8000-0000000000a1');
select is(feed_count('swap'), 1, 'a Swap is in the Feed — every one is shown (§18.4)');
select is(
  (select f.before_target from feed f where f.kind = 'swap'), 2,
  'with what the Tile said before');
select is(
  (select f.after_target from feed f where f.kind = 'swap'), 1,
  'and what it says now — the Revision is what makes a Bingo checkable');

-- ---------------------------------------------------------------------------------
-- §14.1 — one Family, one Year, newest first
-- ---------------------------------------------------------------------------------

select is(
  (select count(distinct f.family_id)::int from feed f), 1,
  'every row belongs to the one Family the caller can see');

select is(
  (select count(*)::int from feed f where f.year_id is distinct from year_of('Hertzell Family')),
  0, 'and to the one Year (§14.1)');

select is(
  (select count(*)::int from feed f where f.created_at is null), 0,
  'every row is stamped, so newest-first is total');

select is(feed_total(), 8,
  'eight events so far: 3 Increments, 1 Milestone, 1 outcome, 2 joins, 1 Swap');

-- Reverse-chronological (§14.1), against a known sequence. Everything above was written
-- inside one transaction and shares a now(), so the timestamps are spread here first —
-- ordering asserted against rows that all tie is an assertion about nothing.
select set_config('role', 'postgres', true);
update members    set joined_at   = now() - interval '10 days' where display_name = 'Alice';
update members    set joined_at   = now() - interval '9 days'  where display_name = 'Bob';
update votes      set resolved_at = now() - interval '5 days'  where resolved_at is not null;
update increments set created_at  = now() - interval '3 days'
 where id = '00000000-0000-4000-8000-0000000000c1';
update increments set created_at  = now() - interval '2 days'
 where id = '00000000-0000-4000-8000-0000000000c2';
update increments set created_at  = now() - interval '1 day'
 where id = '00000000-0000-4000-8000-0000000000c3';
update milestones set created_at  = now() - interval '23 hours';
update revisions  set created_at  = now() - interval '1 hour';

select act_as('00000000-0000-4000-8000-0000000000a1');

select is(feed_kinds(100, 0),
  array['swap', 'milestone', 'increment', 'increment', 'increment',
        'vote_resolved', 'member_joined', 'member_joined'],
  'newest first, across every kind at once (§14.1)');

-- Paginated (§14.1). PostgREST turns limit/offset into exactly this.
select is(feed_kinds(3, 0), array['swap', 'milestone', 'increment'],
  'the first page is the newest three');
select is(feed_kinds(3, 3), array['increment', 'increment', 'vote_resolved'],
  'and the second continues where it stopped, repeating nothing');
select is(feed_kinds(3, 6), array['member_joined', 'member_joined'],
  'the last page is short rather than padded');

-- ---------------------------------------------------------------------------------
-- A second Family, living its own life
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a3');
select create_family('Okonkwo Family', 'Europe/London');

-- Chidi is a Managed Member: a child with no login, played through Carol's Account
-- (ADR-0003). §4.2 is explicit that what Carol does on his behalf is attributed to him.
select set_config('role', 'postgres', true);
insert into members (family_id, guardian_account_id, display_name, role, status)
  values (family_named('Okonkwo Family'),
          '00000000-0000-4000-8000-0000000000a3', 'Chidi', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a3');
select open_year((select id from families where name = 'Okonkwo Family'), 2027);
select write_goal(tile_of('Carol', 5), 'Swim the Serpentine', 4, 'swims');
select write_goal(tile_of('Chidi', 3), 'Learn ten chords', 10, 'chords');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where id = year_of('Okonkwo Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Okonkwo Family');

select act_as_cron();
select is(seal_due_boards(), 2, 'the second Family seals too');

select act_as('00000000-0000-4000-8000-0000000000a3');
insert into increments (id, tile_id, member_id, note)
  values ('00000000-0000-4000-8000-0000000000c9', tile_of('Carol', 5), member_of('Carol'),
          'freezing');

-- ---------------------------------------------------------------------------------
-- §4.2 — a Guardian acts, and the Managed Member is credited
-- ---------------------------------------------------------------------------------
--
-- Carol taps for Chidi from her own Account. The Feed must name Chidi: the Board is his,
-- the Goal is his, and the Account is not the player (ADR-0003). This is the one
-- attribution rule the PRD states about the Feed by name.

insert into increments (id, tile_id, member_id, note)
  values ('00000000-0000-4000-8000-0000000000ca', tile_of('Chidi', 3), member_of('Chidi'),
          'G, C and D');

select is(
  (select f.member_id from feed f where f.id = '00000000-0000-4000-8000-0000000000ca'),
  member_of('Chidi'),
  'attributed to the Managed Member, not the Guardian who tapped (§4.2)');

select is(
  (select count(*)::int from feed f where f.member_id = member_of('Carol')
     and f.kind = 'increment'), 1,
  'and Carol is credited only with her own');

select is(
  (select f.member_id from feed f
    where f.kind = 'member_joined' and f.goal_text is null
      and f.member_id = member_of('Chidi')),
  member_of('Chidi'),
  'his arrival is his own too — the Feed never names an Account');

-- ---------------------------------------------------------------------------------
-- §14.3 — the boundary, as zero rows and never an error
-- ---------------------------------------------------------------------------------
--
-- A denied read returns ZERO ROWS. A 403 would confirm the resource exists; zero rows
-- tells an outsider nothing (api.md §9, ADR-0004). §14.3 requires this half to be a
-- database test, and requires it to assert emptiness rather than a raised exception.

select is(feed_count('increment'), 2,
  'Carol sees her own Family''s two Increments — hers and Chidi''s');

select is(
  (select count(*)::int from feed f where f.note = 'round the reservoir'), 0,
  'CROSS-FAMILY: and none of the Hertzell Family''s (§14.3)');

select is(
  (select count(*)::int from feed f where f.family_id = family_named('Hertzell Family')),
  0, 'CROSS-FAMILY: not one row of the other Family''s Feed, of any kind');

select lives_ok($$select * from feed$$,
  'and the boundary is silence, not an error (api.md §9)');

select act_as('00000000-0000-4000-8000-0000000000a1');
select is(
  (select count(*)::int from feed f where f.family_id = family_named('Okonkwo Family')),
  0, 'CROSS-FAMILY: it holds in the other direction too');

select is(feed_count('increment'), 3,
  'and Alice still sees exactly her own Family''s three');

-- ---------------------------------------------------------------------------------
-- §14.1 — a second Year, and the Freeze between them
-- ---------------------------------------------------------------------------------
--
-- Everything above ran against a Family with one Year, where "scoped to one Year" is
-- true by accident. A Member who arrives between a Freeze and the next opening is the
-- case that decides it: attributing them backwards would drop a new event into permanent
-- family history (§20.1, CONTEXT.md Freeze) and leave them missing from the Year they
-- actually play (§21.4).

select set_config('role', 'postgres', true);
update years set frozen_at = now(), status = 'frozen' where id = year_num('Hertzell Family', 2027);

-- Erin is approved in the gap: the old Year is history, the new one does not exist yet.
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a5',
   'Erin', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select open_year(family_named('Hertzell Family'), 2028)$$,
  'the Family opens its next Year');

select is(
  (select f.year_id from feed f
    where f.kind = 'member_joined' and f.member_id = member_of('Erin')),
  year_num('Hertzell Family', 2028),
  'a Member who arrived between Years belongs to the one they will play');

select isnt(
  (select f.year_id from feed f
    where f.kind = 'member_joined' and f.member_id = member_of('Erin')),
  year_num('Hertzell Family', 2027),
  'and not to the frozen Year, which is closed history (§20.1)');

select is(
  (select count(*)::int from feed f where f.year_id = year_num('Hertzell Family', 2027)),
  8, 'last Year keeps its eight events');

select is(
  (select count(*)::int from feed f where f.year_id = year_num('Hertzell Family', 2028)),
  1, 'and the new Year has only Erin arriving');

select is(
  (select count(*)::int from feed f where f.year_id is null), 0,
  'no row belongs to no Year, so a Year filter loses nothing (§14.1)');

select is(feed_total(), 9, 'the Feed spans both Years until the client filters one');

-- A pending Member has asked, not arrived. They read nothing at all — not the Feed, not
-- Boards, not other Members' names (§3.2). visible_family_ids() requires 'active'.
select act_as('00000000-0000-4000-8000-0000000000a4');
select is(feed_total(), 0,
  'PENDING: a Member awaiting approval sees an empty Feed, not an error (§3.2)');
select lives_ok($$select * from feed$$, 'and gets zero rows rather than a 403');

-- The Feed states the boundary once, by restating none of it. If it ever grows a policy
-- of its own, that is a second copy of ADR-0004 and this assertion should fail.
select act_as_cron();
select is(
  (select count(*)::int from pg_policies where tablename = 'feed'), 0,
  'the Feed carries no policy of its own');

select is(
  (select reloptions::text from pg_class where relname = 'feed'),
  '{security_invoker=true}',
  'because security_invoker hands every row to the base table''s policy (ADR-0004)');

-- An unauthenticated caller cannot address it at all. That is the grant, not a policy,
-- and it is deliberate: a table-level denial to a caller with no session reveals nothing
-- about anyone (20260801000007_grants.sql).
select is(
  has_table_privilege('anon', 'feed', 'select'), false,
  'anon is granted nothing, here as everywhere');
select is(
  has_table_privilege('authenticated', 'feed', 'select'), true,
  'and a signed-in caller reads it through PostgREST, with no endpoint of its own');

select * from finish();
rollback;
