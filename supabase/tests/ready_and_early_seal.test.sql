-- Slice 22, server half: Ready, and the early Seal.
--
-- Acceptance test (PRD §22):
--   Given a Family in an open Setup Window whose Members have all written 24 Goals
--   When the last of them marks their Board ready
--   Then every Board in that Family seals immediately, the Center Vote resolves on the
--   Ballots cast, and play still does not open until the Year begins
--
-- Two rules are being held apart here and both are load-bearing:
--
--   * The deadline is a backstop, not the only door. Unanimity is the second door, and
--     nothing else opens it — not the Organizer, not a full Board nobody has declared.
--   * Sealing closes authoring; it does not start the Year. A Family that finishes in
--     December waits for January to play, and everything that used to read `sealed_at`
--     as "the Year is under way" now reads `play_opens_at` too.

begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

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

create or replace function board_of(name text) returns uuid
language sql stable as $$
  select b.id from boards b
    join years y on y.id = b.year_id
   where b.member_id = member_of(name)
     and y.frozen_at is null
   order by y.calendar_year
   limit 1
$$;

create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

-- Positions are dealt at seal, so before it the square written to is the square held.
create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $$
  select t.id from tiles t
   where t.board_id = board_of(name)
     and t.position = case
           when (select b.sealed_at from boards b where b.id = board_of(name)) is null
             then pos
           else dealt_position(board_of(name), pos)
         end
$$;

-- All 24 authorable squares, named after the square they were written to so the deal can
-- be checked afterwards. Runs as whoever called it — write_goal() is self-only.
create or replace function fill_board(name text) returns void
language plpgsql as $$
declare p int;
begin
  for p in 0..24 loop
    if p <> 12 then
      perform write_goal(tile_of(name, p), 'Goal ' || p, 3, 'times');
    end if;
  end loop;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'alice@example.test',  '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b2', 'bob@example.test',    '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b3', 'chidi@example.test',  '{"full_name":"Chidi"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b4', 'dara@example.test',   '{"full_name":"Dara"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b5', 'esther@example.test', '{"full_name":"Esther"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b6', 'frank@example.test',  '{"full_name":"Frank"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b7', 'grace@example.test',  '{"full_name":"Grace"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000b8', 'hal@example.test',    '{"full_name":"Hal"}'::jsonb);

-- Alice (Organizer), Theo (Managed, played by Alice), Bob. Year 2027 in New York, so
-- `play_opens_at` is genuinely months away and "sealed" and "playable" cannot be confused
-- by accident.
select act_as('00000000-0000-4000-8000-0000000000b1');
select create_family('Hertzell Family', 'America/New_York');
select create_managed_member(
  (select id from families where name = 'Hertzell Family'), 'Theo');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000b2', 'Bob', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000b1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);

-- ---------------------------------------------------------------------------------
-- §22.2 — Ready is offered by a full Board and taken by a tap
-- ---------------------------------------------------------------------------------

select throws_ok(
  $$select mark_board_ready(board_of('Alice'))$$,
  'PT409', null,
  'a Board with empty squares cannot be called done (§22.2)');

select fill_board('Alice');

select lives_ok(
  $$select mark_board_ready(board_of('Alice'))$$,
  'a Board with a Goal on all 24 authorable squares can (§22.2)');

select isnt((select ready_at from boards where id = board_of('Alice')), null,
  'and ready_at records when they said so');

-- Twenty-four, not twenty-five: position 12 is the Family's until the vote resolves
-- (§6.5), and in personal mode it is written in the seven days AFTER the seal (§9.5).
-- Requiring it would make Ready unreachable for every Family that ever votes personal.
select is((select count(*)::int from tiles t
            where t.board_id = board_of('Alice') and t.goal_id is null),
  1, 'with the Centre still empty — it was never theirs to fill (§6.5, §9.5)');

select is((select status from years where id = year_of('Hertzell Family')), 'setup',
  'one Member being done does not seal anything (§22.3)');

select throws_ok(
  $$select mark_board_ready(board_of('Bob'))$$,
  '42501', null,
  'and nobody can declare somebody else finished');

-- Idempotent, and the timestamp does not move: "when this Member finished" is a fact
-- about them, not a count of how many times they tapped.
create temporary table first_stamp as
  select ready_at from boards where id = board_of('Alice');

select lives_ok(
  $$select mark_board_ready(board_of('Alice'))$$,
  'marking a ready Board ready again is not an error');

select is((select ready_at from boards where id = board_of('Alice')),
  (select ready_at from first_stamp),
  'and does not move the stamp');

-- ---------------------------------------------------------------------------------
-- §22.4 — revocable, right up until it is the last one
-- ---------------------------------------------------------------------------------

select lives_ok(
  $$select clear_board_ready(board_of('Alice'))$$,
  'a Member can take it back while the Family is still waiting on someone (§22.4)');

select is((select ready_at from boards where id = board_of('Alice')), null,
  'and the Family is waiting on them again');

select lives_ok($$select mark_board_ready(board_of('Alice'))$$, 'and can say it again');

-- ---------------------------------------------------------------------------------
-- §22.3 — the last Member seals the Family, inside its own Setup Window
-- ---------------------------------------------------------------------------------

-- Theo is Managed: Alice authors and declares for him (§4.2), and it is Theo's Board
-- that is ready, not Alice's twice.
select fill_board('Theo');
select mark_board_ready(board_of('Theo'));

select is((select status from years where id = year_of('Hertzell Family')), 'setup',
  'two of three is still not everyone');

select act_as('00000000-0000-4000-8000-0000000000b2');
select fill_board('Bob');

select ok(
  (select now() < setup_deadline from years where id = year_of('Hertzell Family')),
  'the Setup Window has NOT expired — whatever happens next is early (§22.1)');

select lives_ok(
  $$select mark_board_ready(board_of('Bob'))$$,
  'the last Member marks their Board done');

select is((select status from years where id = year_of('Hertzell Family')), 'active',
  'and the Year is under way (§22.3)');

select is((select count(*)::int from boards b
            where b.year_id = year_of('Hertzell Family') and b.sealed_at is null),
  0, 'every Board in the Family sealed, not just the one that was tapped');

select isnt((select center_mode from years where id = year_of('Hertzell Family')),
  'undecided',
  'the Center Vote resolved on the way past, as it does at the deadline (api.md §7)');

-- The deal is not skipped on this path. It is the one thing that happens exactly once
-- per Board and it lives inside a seal, so a second door into sealing is exactly how it
-- would come to be forgotten (migration 34).
select is(
  (select g.text from goals g
     join tiles t on t.goal_id = g.id
    where t.board_id = board_of('Alice')
      and t.position = dealt_position(board_of('Alice'), 0)),
  'Goal 0',
  'and the Board was dealt as it sealed — the Goal written first is where §4.1 puts it');

-- §8.1's "changeable until the Setup Window closes" has been reached, not broken: the
-- window closed. Every Member said so.
select act_as('00000000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$select cast_ballot(
      (select v.id from votes v where v.year_id = year_of('Hertzell Family')
        and v.kind = 'mode'),
      member_of('Alice'), 'shared')$$,
  'PT403', null,
  'and a Ballot cannot be moved afterwards — marking ready is what makes it final');

select throws_ok(
  $$select mark_board_ready(board_of('Alice'))$$,
  'PT403', null,
  'nor can a sealed Board be re-declared');

select throws_ok(
  $$select clear_board_ready(board_of('Alice'))$$,
  'PT403', null,
  'nor un-declared — sealing is the door every other edit meets too (§10.3)');

-- ---------------------------------------------------------------------------------
-- §22.5 — sealed is not the same as playable
-- ---------------------------------------------------------------------------------
--
-- This is the whole reason the two columns were split. The Boards above sealed in
-- August; the Year they belong to starts on 1 January.

select throws_ok(
  $$insert into increments (id, tile_id, member_id)
    values ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0),
            member_of('Alice'))$$,
  '42501', null,
  'a Board that sealed early takes no Increment until its Year begins (§11.5, §22.5)');

-- And the §9.5 window has not started running either. Eight days after this seal is
-- still four months before the Year, and a free write that expired over Christmas would
-- be a window in name only (migration 40).
select set_config('role', 'postgres', true);
update boards set sealed_at = now() - interval '8 days'
 where year_id = year_of('Hertzell Family');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$select write_goal(tile_of('Alice', 12), 'Learn to sail', 4, 'trips')$$,
  'the free write of a personal Centre runs from the start of the Year, not the seal '
  '(§9.5, §18.5)');

-- The Year arrives.
select set_config('role', 'postgres', true);
update years set play_opens_at = now() - interval '1 minute'
 where id = year_of('Hertzell Family');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$insert into increments (id, tile_id, member_id)
    values ('00000000-0000-4000-8000-0000000000c2', tile_of('Alice', 0),
            member_of('Alice'))$$,
  'and the same tap lands the moment play opens — nothing else had to happen');

-- ---------------------------------------------------------------------------------
-- §22.1 — the deadline is still the only other door
-- ---------------------------------------------------------------------------------
--
-- A second Family, one of whose Members has said nothing at all. §8.4 says silence must
-- not block an outcome; §22.1 is its mirror, and says silence must not cause one either.

select act_as('00000000-0000-4000-8000-0000000000b3');
select create_family('Okonkwo Family', 'Europe/London');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Okonkwo Family'),
   '00000000-0000-4000-8000-0000000000b4', 'Dara', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000b3');
select open_year((select id from families where name = 'Okonkwo Family'), 2027);
select fill_board('Chidi');
select mark_board_ready(board_of('Chidi'));

select throws_ok(
  $$select seal_year(year_of('Okonkwo Family'))$$,
  'PT403', null,
  'the Organizer still cannot seal early on their own authority (§10.1)');

select act_as_cron();
select is((select count(*)::int from boards b
            where b.year_id = year_of('Okonkwo Family') and b.sealed_at is not null),
  0, 'and the sweep leaves a Family that is waiting on someone alone (§22.1)');

-- Dara votes shared and proposes, then finishes. The Centre resolving on the Ballots
-- actually cast is the same rule as at the deadline (§9.2) — an early seal does not get
-- a different tally.
select set_config('role', 'postgres', true);
insert into proposals (id, vote_id, member_id, text)
  select '00000000-0000-4000-8000-0000000000d1', v.id, member_of('Dara'),
         'Walk the Ridgeway together'
    from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'goal';

select act_as('00000000-0000-4000-8000-0000000000b4');
select cast_ballot(
  (select v.id from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'mode'),
  member_of('Dara'), 'shared');
select cast_ballot(
  (select v.id from votes v where v.year_id = year_of('Okonkwo Family') and v.kind = 'goal'),
  member_of('Dara'), null, '00000000-0000-4000-8000-0000000000d1');

-- A Member who is no longer active must not hold the Family at the line. Boards are only
-- ever dealt to active Members, so this shape has to be built rather than found: Hal is
-- approved (which deals him a Board through the trigger) and then set back to pending, as
-- an Organizer turning somebody away would. `year_is_ready()`'s `m.status = 'active'`
-- clause is the whole subject — delete it and this test is the only thing that notices.
select set_config('role', 'postgres', true);
insert into members (id, family_id, account_id, display_name, role, status)
  values ('00000000-0000-4000-8000-0000000000ce',
          (select id from families where name = 'Okonkwo Family'),
          '00000000-0000-4000-8000-0000000000b8', 'Hal', 'member', 'pending');
update members set status = 'active' where id = member_of('Hal');

select isnt((select board_of('Hal')), null,
  'Hal is dealt a Board while he is active');

select set_config('role', 'postgres', true);
update members set status = 'pending' where id = member_of('Hal');

select act_as('00000000-0000-4000-8000-0000000000b4');
select fill_board('Dara');
select mark_board_ready(board_of('Dara'));

select is((select status from years where id = year_of('Okonkwo Family')), 'active',
  'a Board belonging to a Member who is no longer active does not hold the Family up');

select is((select center_mode from years where id = year_of('Okonkwo Family')), 'shared',
  'a single Ballot decides an early Centre, exactly as it would at the deadline (§8.2)');

select is(
  (select fg.text from family_goals fg where fg.year_id = year_of('Okonkwo Family')),
  'Walk the Ridgeway together',
  'and the winning Proposal became the Family Goal (§9.4)');

-- `<=`, not `<`: now() is the transaction's clock, so a `closes_at` pulled back to it
-- during this transaction is equal to it rather than behind it.
select is(
  (select v.closes_at <= now() from votes v
    where v.year_id = year_of('Okonkwo Family') and v.kind = 'mode'),
  true,
  'with the Vote''s own clock corrected — a resolved Vote is not still counting down');

-- The Family Goal is the one kind of progress with no Increment behind it, so it is the
-- one that has to refuse an early Year itself.
select throws_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Dara'))$$,
  'PT425', null,
  'and it cannot be marked done before the Year it belongs to starts (§12.3, §22.5)');

-- And the refusal is about the date and nothing else, which only the pair of assertions
-- proves: an unconditional PT425 passes the one above on its own.
select set_config('role', 'postgres', true);
update years set play_opens_at = now() - interval '1 minute'
 where id = year_of('Okonkwo Family');

select act_as('00000000-0000-4000-8000-0000000000b4');
select lives_ok(
  $$select complete_family_goal(year_of('Okonkwo Family'), member_of('Dara'))$$,
  'and can be, the moment the Year starts');

-- ---------------------------------------------------------------------------------
-- §22.3 — somebody arriving resets it
-- ---------------------------------------------------------------------------------
--
-- A Member approved during the Setup Window gets an ordinary Board (migration 38). They
-- are a Member the Family is now waiting for, and the alternative — treating the Year as
-- unanimous because everyone who was here yesterday said so — would seal a Board its
-- owner had never seen.

select act_as('00000000-0000-4000-8000-0000000000b5');
select create_family('Nakamura Family', 'Asia/Tokyo');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Nakamura Family'),
   '00000000-0000-4000-8000-0000000000b6', 'Frank', 'member', 'active'),
  ((select id from families where name = 'Nakamura Family'),
   '00000000-0000-4000-8000-0000000000b7', 'Grace', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000b5');
select open_year((select id from families where name = 'Nakamura Family'), 2027);
select fill_board('Esther');
select mark_board_ready(board_of('Esther'));

-- Grace is approved between the two declarations.
select set_config('role', 'postgres', true);
update members set status = 'active' where id = member_of('Grace');

select isnt((select board_of('Grace')), null,
  'a Member approved mid-window gets a Board (migration 38)');

select act_as('00000000-0000-4000-8000-0000000000b6');
select fill_board('Frank');
select mark_board_ready(board_of('Frank'));

select is((select status from years where id = year_of('Nakamura Family')), 'setup',
  'everyone who was here yesterday is not everyone (§22.3)');

-- ---------------------------------------------------------------------------------
-- §22.4 with §6.4 — a declaration must not outlive the Board it described
-- ---------------------------------------------------------------------------------
--
-- The failure this prevents is the one the whole "declared, never inferred" argument is
-- about, arriving by the other road: Esther says she is done and then goes back to reword
-- a square, which §6.4 openly invites. If `ready_at` survives that, the next Member's tap
-- seals her Board with an empty square on it — silently, permanently, and §18.5 prices
-- getting it back at a Swap.

select act_as('00000000-0000-4000-8000-0000000000b5');
select lives_ok(
  $$select clear_goal(tile_of('Esther', 5))$$,
  'a Member who has said they are done may still empty a square (§6.4)');

select is((select ready_at from boards where id = board_of('Esther')), null,
  'and doing so withdraws the declaration that went with it (§22.4)');

select act_as('00000000-0000-4000-8000-0000000000b7');
select fill_board('Grace');
select mark_board_ready(board_of('Grace'));

select is((select status from years where id = year_of('Nakamura Family')), 'setup',
  'so the last Member''s tap does not seal a Board that has stopped being finished');

select is((select count(*)::int from tiles t
            where t.board_id = board_of('Esther') and t.goal_id is null),
  2, 'and Esther''s square is still hers to fill, at no cost — Centre and square 5');

select act_as('00000000-0000-4000-8000-0000000000b5');
select write_goal(tile_of('Esther', 5), 'Goal 5', 3, 'times');
select lives_ok(
  $$select mark_board_ready(board_of('Esther'))$$,
  'she says it again once the square is back');

select is((select status from years where id = year_of('Nakamura Family')), 'active',
  'and the Family seals — the newcomer and the rewritten square both counted');

-- ---------------------------------------------------------------------------------
-- The sweep is the backstop for the backstop
-- ---------------------------------------------------------------------------------
--
-- mark_board_ready() seals synchronously, so this only matters when that transaction's
-- savepoint swallowed a failure. A Year that is ready and unsealed is a Family staring at
-- a countdown that should already have ended, and five minutes is the longest it can now
-- last. Built by hand, because the synchronous path is precisely what is being bypassed.

select set_config('role', 'postgres', true);
update years set status = 'setup', sealed_at = null, center_mode = 'undecided'
 where id = year_of('Nakamura Family');
update boards set sealed_at = null where year_id = year_of('Nakamura Family');

-- And a second Family in the same sweep, due the OLD way: nobody ready, the date arrived.
-- The two doors are counted by one `sealed := sealed + this_year` accumulator, and a
-- sweep that only ever sees one Year at a time cannot tell whether it accumulates or
-- overwrites.
select act_as('00000000-0000-4000-8000-0000000000b8');
select create_family('Yamada Family', 'Australia/Sydney');
select open_year((select id from families where name = 'Yamada Family'), 2027);

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute',
                 play_opens_at  = now() - interval '1 minute'
 where id = year_of('Yamada Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id = year_of('Yamada Family');

select act_as_cron();
select is(seal_due_boards(), 4,
  'one sweep, both doors: three ready Boards and one Family whose date simply arrived');

select is((select status from years where id = year_of('Nakamura Family')), 'active',
  'and leaves the ready one under way');

select is((select status from years where id = year_of('Yamada Family')), 'active',
  'and the one that never finished sealed on its deadline, empty squares and all (§10.2)');

-- ---------------------------------------------------------------------------------
-- §21.1 — a late joiner seals alone, and does not wait out a week of a Year
-- ---------------------------------------------------------------------------------
--
-- This is the case that costs the most: their Board is finished, the Centre was decided
-- months ago (§21.2), and nobody else's window is touched by their seal. A week of the
-- Year is the whole cost of making them wait for a deadline that exists to protect
-- authoring time they are not using.

select set_config('role', 'postgres', true);
insert into members (id, family_id, guardian_account_id, display_name, role, status)
  values ('00000000-0000-4000-8000-0000000000cf',
          (select id from families where name = 'Hertzell Family'),
          '00000000-0000-4000-8000-0000000000b1', 'Nia', 'member', 'pending');

create temporary table seal_stamps as
  select distinct sealed_at from boards where year_id = year_of('Hertzell Family');

update members set status = 'active' where id = member_of('Nia');

select isnt((select b.personal_setup_deadline from boards b
              where b.member_id = member_of('Nia')), null,
  'a Member approved into an active Year gets a personal window of their own (§21.1)');

select act_as('00000000-0000-4000-8000-0000000000b1');
select fill_board('Nia');
select mark_board_ready(board_of('Nia'));

-- Read back as the owner of the temporary table above.
select set_config('role', 'postgres', true);
select isnt((select b.sealed_at from boards b where b.member_id = member_of('Nia')), null,
  'and their Board seals the moment they are done, not seven days later (§22.6)');

select is((select count(*)::int from seal_stamps s
            join boards b on b.sealed_at = s.sealed_at
           where b.year_id = year_of('Hertzell Family')
             and b.member_id <> member_of('Nia')),
  3, 'while nobody else''s seal is touched — a personal window is personal');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$insert into increments (id, tile_id, member_id)
    values ('00000000-0000-4000-8000-0000000000c3', tile_of('Nia', 0), member_of('Nia'))$$,
  'and they can play immediately, in a Year that is already running');

-- §9.5's window, from the other side of `greatest()`.
--
-- Alice's case above pins one half: her Board sealed eight days ago and her free write is
-- still open, because her Year had not started. This pins the other, and only this one
-- can — an implementation reading `play_opens_at + 7 days` and forgetting the seal
-- entirely passes every other assertion in the suite. Nia sealed six days ago in a Year
-- that has been running for the better part of one, so the seal is the later instant and
-- the window is hers.
select set_config('role', 'postgres', true);
update years set play_opens_at = now() - interval '300 days'
 where id = year_of('Hertzell Family');
update boards set sealed_at = now() - interval '6 days'
 where member_id = member_of('Nia');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$select write_goal(tile_of('Nia', 12), 'Learn to sail', 4, 'trips')$$,
  'a late joiner''s free write runs from THEIR seal, not from the start of the Year '
  '(§9.5, §21.1)');

-- ---------------------------------------------------------------------------------
-- Two doors that must stay shut
-- ---------------------------------------------------------------------------------

-- `deal_positions()` permutes goal_id between a Board's Tiles, and migration 34 says it
-- is "safe only at the seal and never twice". It kept PostgREST's default PUBLIC EXECUTE
-- for six migrations, so any signed-in Account could reshuffle any Board id in the
-- database — moving a year of accumulated Increments onto different Goals.
select throws_ok(
  $$select deal_positions(board_of('Alice'))$$,
  '42501', null,
  'no Member may re-deal a Board — that belongs to the seal and to nothing else');

-- Its two pure siblings stay reachable: they answer where a Board's squares WOULD land
-- and write nothing.
select lives_ok(
  $$select dealt_position(board_of('Alice'), 0)$$,
  'while asking where a square lands is harmless and stays open');

-- A frozen Year is permanently read-only (§20.1), and taking back a declaration is a
-- write to it. `freeze_year()` does not seal outstanding Boards, so this state is
-- reachable rather than theoretical.
select set_config('role', 'postgres', true);
update boards set sealed_at = null, ready_at = now() where member_id = member_of('Nia');
update years set frozen_at = now(), status = 'frozen'
 where id = year_of('Hertzell Family');

select act_as('00000000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$select clear_board_ready(board_of('Nia'))$$,
  '42501', null,
  'and a declaration cannot be withdrawn inside a frozen Year either (§20.1)');

select * from finish();
rollback;
