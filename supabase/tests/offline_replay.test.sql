-- Slice 17, server half: Offline logging.
--
-- Acceptance test (PRD §17):
--   Given a Member with no network connection
--   When they log 3 Increments and connectivity returns
--   Then exactly 3 Increments exist server-side — and re-running the sync creates no
--   duplicates
--
-- The queue itself is the client's (§17.1, §17.2, §17.3, §17.5) and there is no client
-- yet. What the server owes is the property the queue is built on: §17.4, idempotency
-- from the client-generated UUID, "no conflict resolution logic is needed".
--
-- That was true when it was written, and slice 11 tested the insert. It is worth
-- retesting now for a reason that did not exist then: an Increment insert now fires four
-- triggers. It can complete a Tile (§12), close a Line (§13), record a Bingo, and put a
-- push in the outbox (§15). "Creates no duplicates" has to mean none of those happen
-- twice either — a replayed queue that re-notifies the Family is the same bug wearing a
-- different coat, and a worse one, because §15.3 says notification permission is a
-- one-way door.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

create or replace function queued(of_kind text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications n where n.kind = of_kind
$$;

-- The whole offline queue, drained in one statement, exactly as the client will send it:
-- an upsert keyed on the client-generated id. ON CONFLICT DO NOTHING and not DO UPDATE —
-- §11.3 makes the log append-only, and there is no UPDATE grant to fall back on.
create or replace function drain_queue(name text, taps uuid[], pos int) returns void
language plpgsql as $$
declare tap_id uuid;
begin
  foreach tap_id in array taps loop
    insert into increments (id, tile_id, member_id)
    values (tap_id, tile_of(name, pos), member_of(name))
        on conflict (id) do nothing;
  end loop;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Hertzell Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year(family_named('Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 3, 'walks');
select write_goal(tile_of('Alice', 1), 'Read a book', 5, 'books');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute'
 where family_id = family_named('Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = (select id from years where family_id = family_named('Hertzell Family'));

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
                ('Alice', 1, 'Read a book')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

select is(seal_due_boards(), 2, 'both Boards seal and the Year is under way');
delete from notifications;

-- ---------------------------------------------------------------------------------
-- The acceptance test
-- ---------------------------------------------------------------------------------
--
-- Three taps made with no network. The ids were generated on the device (§11.2), which
-- is the entire mechanism — there is nothing else to reconcile.

select act_as('00000000-0000-4000-8000-0000000000a1');
select drain_queue('Alice', array[
  '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000c2',
  '00000000-0000-4000-8000-0000000000c3']::uuid[], 0);

select is((select count(*)::int from increments), 3,
  'connectivity returns and exactly 3 Increments exist server-side');

select act_as_cron();
select is((select count(*)::int from milestones where type = 'tile_completed'), 1,
  'the third one completed the Tile, once (§12.2)');
select is(queued('tile_completed'), 1, 'and put one push in the outbox (§15.1)');

-- The sync runs again. A queue that has not been acked, an app relaunched mid-drain, a
-- second device holding the same rows — §17.3 says the queue survives restarts, so this
-- is ordinary, not exceptional.
select act_as('00000000-0000-4000-8000-0000000000a1');
select drain_queue('Alice', array[
  '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000c2',
  '00000000-0000-4000-8000-0000000000c3']::uuid[], 0);

select is((select count(*)::int from increments), 3,
  're-running the sync creates no duplicates');

select act_as_cron();
select is((select count(*)::int from milestones where type = 'tile_completed'), 1,
  'nor a second Milestone');
select is(queued('tile_completed'), 1,
  'nor a second push — permission is a one-way door and a replay must not spend it (§15.3)');

-- Ten more drains. The property is not "survives one retry", it is that the operation
-- has no memory of how many times it has run.
select act_as('00000000-0000-4000-8000-0000000000a1');
do $$
begin
  for i in 1..10 loop
    perform drain_queue('Alice', array[
      '00000000-0000-4000-8000-0000000000c1',
      '00000000-0000-4000-8000-0000000000c2',
      '00000000-0000-4000-8000-0000000000c3']::uuid[], 0);
  end loop;
end;
$$;

select is((select count(*)::int from increments), 3, 'and no number of retries changes it');

select act_as_cron();
select is((select count(*)::int from milestones), 1, 'still one Milestone');
select is((select count(*)::int from notifications), 1, 'still one push');

-- ---------------------------------------------------------------------------------
-- A partly-drained queue, which is the normal case
-- ---------------------------------------------------------------------------------
--
-- Connectivity does not return cleanly. Two rows land, the ack is lost, and the client
-- resends all three because it does not know which arrived. That is precisely what
-- §17.4 means by "no conflict resolution logic is needed".

select act_as('00000000-0000-4000-8000-0000000000a1');
select drain_queue('Alice', array[
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d2']::uuid[], 1);

select is((select count(*)::int from increments where tile_id = tile_of('Alice', 1)), 2,
  'two of the three land before the connection drops');

select drain_queue('Alice', array[
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d3']::uuid[], 1);

select is((select count(*)::int from increments where tile_id = tile_of('Alice', 1)), 3,
  'the client resends all three and only the missing one is added');

-- ---------------------------------------------------------------------------------
-- §11.3 — and why the upsert must be DO NOTHING
-- ---------------------------------------------------------------------------------
--
-- PostgREST's default upsert resolution is merge-duplicates, which is an UPDATE. There is
-- no UPDATE grant on `increments` and there is not going to be one: the log is
-- append-only and deleting is the only mutation permitted. A client that sends the
-- default header does not get a silent overwrite — it gets an error, which is the right
-- failure. api.md §5 states the header the queue must send.

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0), member_of('Alice'))
      on conflict (id) do update set note = 'overwritten'
$$, '42501', null,
  'merge-duplicates is refused — there is no UPDATE grant, by design (§11.3)');

select throws_ok($$
  update increments set note = 'edited' where id = '00000000-0000-4000-8000-0000000000c1'
$$, '42501', null, 'and an Increment cannot be edited by any other route');

select is((select count(*)::int from increments
            where id = '00000000-0000-4000-8000-0000000000c1' and note is null), 1,
  'so a replay can never rewrite what the first tap said');

-- ---------------------------------------------------------------------------------
-- What a replay must NOT move: when the tap happened
-- ---------------------------------------------------------------------------------
--
-- `occurred_at` is the client's to state precisely because the queue replays taps days
-- after they happened (schema.md §5) — it is the reason the column exists. A drain that
-- overwrote it with the arrival time would erase the only thing the offline queue was
-- trying to preserve, and Wrapped hands out "biggest month" and "most consistent" from it
-- (§20.4).

-- Everything above happened inside one transaction, so the Boards sealed at now() and no
-- tap can predate them. The Year is moved back a month, because a queue holding taps from
-- before the Board existed is the case §11.5 refuses, not the case §17.3 is about.
select set_config('role', 'postgres', true);
update boards set sealed_at = now() - interval '30 days';
update years  set sealed_at = now() - interval '30 days';

select act_as('00000000-0000-4000-8000-0000000000a1');
insert into increments (id, tile_id, member_id, occurred_at)
values ('00000000-0000-4000-8000-0000000000e1', tile_of('Alice', 1), member_of('Alice'),
        now() - interval '2 days')
    on conflict (id) do nothing;

select ok(
  (select i.occurred_at from increments i where i.id = '00000000-0000-4000-8000-0000000000e1')
    < now() - interval '1 day',
  'a tap made two days ago keeps its own time when it finally syncs');

-- The same row again, now claiming it happened this instant.
insert into increments (id, tile_id, member_id, occurred_at)
values ('00000000-0000-4000-8000-0000000000e1', tile_of('Alice', 1), member_of('Alice'), now())
    on conflict (id) do nothing;

select ok(
  (select i.occurred_at from increments i where i.id = '00000000-0000-4000-8000-0000000000e1')
    < now() - interval '1 day',
  'and a replay does not move it — the first tap is the fact (§17.4)');

-- ---------------------------------------------------------------------------------
-- The bounds still hold on a replayed tap
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$
  insert into increments (id, tile_id, member_id, occurred_at)
  values ('00000000-0000-4000-8000-0000000000e2', tile_of('Alice', 1), member_of('Alice'),
          now() - interval '400 days')
$$, 'PT403', null,
  'a tap from before the Board existed is refused, queue or no queue (§11.5)');

-- A device whose clock runs fast is benign, and refusing it would lose a real tap the
-- queue then retries forever (§17.2).
insert into increments (id, tile_id, member_id, occurred_at)
values ('00000000-0000-4000-8000-0000000000e3', tile_of('Alice', 1), member_of('Alice'),
        now() + interval '3 hours');

select ok(
  (select i.occurred_at from increments i where i.id = '00000000-0000-4000-8000-0000000000e3')
    <= now(),
  'a fast device clock is pulled back rather than rejected');

-- ---------------------------------------------------------------------------------
-- A queue that syncs into a Year that has since frozen
-- ---------------------------------------------------------------------------------
--
-- The one case the client cannot retry its way out of, and so the one the client has to
-- surface rather than swallow. §20.1: a frozen Year is permanently read-only, and Wrapped
-- has already been generated from it.

select act_as_cron();
select is((select count(*)::int from increments), 8, 'eight taps in the log');

select set_config('role', 'postgres', true);
update years set frozen_at = now(), status = 'frozen'
 where family_id = family_named('Hertzell Family');

select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000f1', tile_of('Alice', 0), member_of('Alice'))
$$, '42501', null,
  'a tap arriving after the Freeze is refused — history is permanent (§20.1)');

-- And the replay of a tap the server ALREADY HAS fails too, which is worth stating
-- because it is the one place idempotency stops being invisible.
--
-- RLS is checked on the proposed row before ON CONFLICT gets to discard it, so a stale
-- queue draining into a frozen Year errors on every row — including the ones that landed
-- months ago and changed nothing. Nothing is written either way; the difference is that
-- the client is told.
--
-- That makes it a terminal failure rather than a retryable one, and the queue has to
-- know the difference: §17.2 retries on reconnect forever, and a Year does not unfreeze.
-- api.md §5 says so.
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0), member_of('Alice'))
      on conflict (id) do nothing
$$, '42501', null,
  'and so is replaying one it already has — the queue must drop, not retry');

select act_as_cron();
select is((select count(*)::int from increments), 8, 'and the log is unchanged');

-- ---------------------------------------------------------------------------------
-- §17.1 — the scope is narrow on purpose
-- ---------------------------------------------------------------------------------
--
-- "Offline queue covers Increments only. Authoring, voting, and invites remain
-- online-only. Deliberately narrow." That is not a client-side convention: the tables
-- those would write have UPDATE grants and no client-generated primary key, so replaying
-- them would not be idempotent. The narrowness is a property of the schema.

select is(
  (select count(*)::int from information_schema.column_privileges
    where table_name = 'increments' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0, 'increments cannot be updated, which is what makes a replay safe');

select isnt(
  (select count(*)::int from information_schema.table_privileges
    where table_name = 'ballots' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0, 'a Ballot can be — which is exactly why voting is not in the queue (§17.1)');

select is(
  (select column_default from information_schema.columns
    where table_name = 'increments' and column_name = 'id'),
  null,
  'and an Increment id has no server default: the client must generate it (§11.2)');

select isnt(
  (select column_default from information_schema.columns
    where table_name = 'ballots' and column_name = 'id'),
  null, 'unlike every other table, which mints its own');

select * from finish();
rollback;
