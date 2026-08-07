-- Slices 8 and 9, server half: the Center Vote.
--
-- Slice 8 acceptance test (PRD §8):
--   Given a Family of 4 in an open Setup Window
--   When 2 Members vote "shared" and 1 votes "personal" and 1 never votes
--   Then the mode resolves to shared, and the non-voter is recorded as an abstention
--   rather than blocking the outcome
--
-- Slice 9 acceptance test (PRD §9):
--   Given a Family whose mode resolved to shared
--   When Members submit 3 Proposals and vote, and "Camping trip" wins with 2 votes
--   Then every Member's Tile 12 holds "Camping trip" as the Family Goal

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function member_of(name text) returns uuid
language sql stable as $$ select id from members where display_name = name $$;

create or replace function vote_of(k text) returns uuid
language sql stable as $$
  select v.id from votes v join years y on y.id = v.year_id
   where v.kind = k and y.calendar_year = 2027
     and y.family_id = (select id from families where name = 'Hertzell Family')
$$;

create or replace function year_2027() returns uuid
language sql stable as $$
  select id from years where calendar_year = 2027
     and family_id = (select id from families where name = 'Hertzell Family')
$$;

-- The Setup Window closes, and only THEN does the Vote resolve — that ordering is the
-- whole sequence in api.md §7, and resolve_center_vote() now enforces it. A test that
-- resolves mid-window is testing a path production never takes.
--
-- SECURITY DEFINER so it works whoever the test is currently acting as; it is created
-- inside the test transaction and rolled back with it.
create or replace function close_window(family text) returns void
language plpgsql security definer as $$
begin
  update years y set setup_deadline = now() - interval '1 minute',
                     play_opens_at  = now() - interval '1 minute'
   where y.family_id = (select f.id from families f where f.name = close_window.family);
  update votes v set closes_at = now() - interval '1 minute'
   where v.year_id in (select y.id from years y
                        where y.family_id = (select f.id from families f
                                              where f.name = close_window.family));
end;
$$;

-- A Family of four: Alice (Organizer), Theo (Managed), Bob, Carol.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a9', 'mallory@example.test', '{"full_name":"Mallory"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');
select create_managed_member((select id from families limit 1), 'Theo');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'active'),
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a3', 'Carol', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);

-- An unrelated Family, so every cross-Family assertion is real.
select act_as('00000000-0000-4000-8000-0000000000a9');
select create_family('Okonkwo Family', 'Europe/London');
select open_year((select id from families where name = 'Okonkwo Family'), 2027);

-- ---------------------------------------------------------------------------------
-- Slice 8: the mode vote
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$select cast_ballot(vote_of('mode'), member_of('Alice'), 'shared')$$,
  'a Member casts a mode Ballot');
select lives_ok(
  $$select cast_ballot(vote_of('mode'), member_of('Theo'), 'shared')$$,
  'a Guardian casts one for their Managed Member — never two of their own (§4.2)');

select act_as('00000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$select cast_ballot(vote_of('mode'), member_of('Bob'), 'personal')$$,
  'and another Member votes the other way');

-- Carol never votes. Her silence must not freeze anyone (§8.4).
select set_config('role', 'postgres', true);
select is((select count(*) from ballots where vote_id = vote_of('mode'))::int, 3,
  '3 of 4 Members have voted');

-- Ballots are changeable until the deadline (§8.1).
select act_as('00000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$select cast_ballot(vote_of('mode'), member_of('Bob'), 'shared')$$,
  'a Member may change their Ballot');
select lives_ok(
  $$select cast_ballot(vote_of('mode'), member_of('Bob'), 'personal')$$,
  'and change it back');
select set_config('role', 'postgres', true);
select is((select count(*) from ballots where vote_id = vote_of('mode'))::int, 3,
  'changing a vote is an UPDATE, never a second row');

-- ---------------------------------------------------------------------------------
-- Slice 9: Proposals
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
insert into proposals (vote_id, member_id, text)
  values (vote_of('goal'), member_of('Alice'), 'Camping trip');
insert into proposals (vote_id, member_id, text)
  values (vote_of('goal'), member_of('Alice'), 'Marathon');
insert into proposals (vote_id, member_id, text)
  values (vote_of('goal'), member_of('Alice'), 'Garden');

select throws_ok($$
  insert into proposals (vote_id, member_id, text)
  values (vote_of('goal'), member_of('Alice'), 'One too many')
$$, 'PT409', null, 'a Member may put forward at most 3 Proposals (§9.1)');

select act_as('00000000-0000-4000-8000-0000000000a2');
select lives_ok($$
  insert into proposals (vote_id, member_id, text)
  values (vote_of('goal'), member_of('Bob'), 'Beach')
$$, 'but the limit is per Member, not per Family');

-- A Proposal is a candidate Family Goal. The mode Vote has nothing to put forward.
select throws_ok($$
  insert into proposals (vote_id, member_id, text)
  values (vote_of('mode'), member_of('Bob'), 'Wrong ballot paper')
$$, '22023', null, 'a Proposal cannot be filed against the mode Vote (§9.1)');

-- Withdrawing your own is fine while it stands alone...
select lives_ok($$
  insert into proposals (id, vote_id, member_id, text)
  values ('00000000-0000-4000-8000-0000000000d1', vote_of('goal'), member_of('Bob'), 'Second thoughts')
$$, 'a Member may put one forward...');
select lives_ok($$
  delete from proposals where id = '00000000-0000-4000-8000-0000000000d1'
$$, '...and withdraw it again while nobody has voted for it');

-- "Camping trip" wins with 2 votes.
select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$
  select cast_ballot(vote_of('goal'), member_of('Alice'), null,
    (select id from proposals where text = 'Camping trip'))
$$, 'a goal Ballot picks a Proposal');
select cast_ballot(vote_of('goal'), member_of('Theo'), null,
  (select id from proposals where text = 'Camping trip'));
select act_as('00000000-0000-4000-8000-0000000000a2');
select cast_ballot(vote_of('goal'), member_of('Bob'), null,
  (select id from proposals where text = 'Marathon'));

select throws_ok($$
  select cast_ballot(vote_of('goal'), member_of('Bob'), 'shared')
$$, '22023', null, 'a goal Ballot cannot be cast as a mode');
select throws_ok($$
  select cast_ballot(vote_of('mode'), member_of('Bob'), null,
    (select id from proposals where text = 'Marathon'))
$$, '22023', null, 'nor a mode Ballot as a Proposal');

-- ...but not once it would take somebody else's Ballot with it. Bob voted for Alice's
-- "Marathon"; ballots.proposal_id cascades, so allowing the withdrawal would delete his
-- vote outright, with the Vote still open and no notice to him.
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$
  delete from proposals where text = 'Marathon'
$$, 'PT409', null,
  'a Proposal others have voted for can no longer be withdrawn');

-- ---------------------------------------------------------------------------------
-- Resolution — both acceptance tests
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

-- §8.1: Ballots are changeable until the deadline. An Organizer who could resolve on
-- day one would end everyone else's say, silently and irreversibly.
select throws_ok($$select resolve_center_vote(year_2027())$$, 'PT403', null,
  'not even the Organizer may resolve while the Setup Window is open (§8.1)');

select close_window('Hertzell Family');
select lives_ok($$select resolve_center_vote(year_2027())$$, 'the Center Vote resolves');

select is((select center_mode from years where id = year_2027()), 'shared',
  'the mode resolves to SHARED on 2 votes to 1 — the non-voter abstained rather than '
  'blocking (§8.2, §8.4)');

select is((select text from family_goals where year_id = year_2027()), 'Camping trip',
  'and "Camping trip" wins the plurality (§9.2)');

select is(
  (select count(*) from tiles t join boards b on b.id = t.board_id
    where b.year_id = year_2027() and t.position = 12
      and t.family_goal_id = (select id from family_goals where year_id = year_2027()))::int,
  4, 'every Member''s Tile 12 holds it — one row referenced by every Board (§9.4)');

select is(
  (select count(distinct t.family_goal_id) from tiles t join boards b on b.id = t.board_id
    where b.year_id = year_2027() and t.position = 12)::int,
  1, 'the SAME row, so completing it completes for everyone at once (§12.3)');

select is((select count(*) from votes where year_id = year_2027() and status = 'resolved')::int,
  2, 'both Votes are marked resolved');

-- Idempotent: pg_cron retries after a partial failure must not double-apply (api.md §7).
select lives_ok($$select resolve_center_vote(year_2027())$$, 'resolution is safe to re-run');
select is((select count(*) from family_goals where year_id = year_2027())::int, 1,
  'and creates no second Family Goal');

-- Voting is closed now.
select throws_ok($$
  select cast_ballot(vote_of('mode'), member_of('Alice'), 'personal')
$$, 'PT403', null, 'Ballots are refused once the Vote has resolved (§8.1)');

select throws_ok($$
  insert into proposals (vote_id, member_id, text)
  values (vote_of('goal'), member_of('Alice'), 'Too late to propose')
$$, 'PT403', null,
  'and so are Proposals — a candidate for a decision already taken (§9.1)');

-- ---------------------------------------------------------------------------------
-- §8.3 / §9.3 — the fallbacks that make silence safe
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);

-- A Family where NOBODY voted at all.
select create_family('Silent Family', 'UTC');
insert into members (family_id, account_id, display_name, role, status)
  values ((select id from families where name = 'Silent Family'),
          '00000000-0000-4000-8000-0000000000a3', 'Quiet', 'member', 'active');
select open_year((select id from families where name = 'Silent Family'), 2027);
select close_window('Silent Family');
select resolve_center_vote(
  (select id from years where family_id = (select id from families where name = 'Silent Family')));
select is(
  (select center_mode from years
    where family_id = (select id from families where name = 'Silent Family')),
  'personal',
  'zero Ballots resolves to personal — the outcome needing no further coordination (§8.3)');

-- A tied mode vote.
select create_family('Split Family', 'UTC');
insert into members (family_id, guardian_account_id, display_name, role, status)
  select (select id from families where name = 'Split Family'),
         '00000000-0000-4000-8000-0000000000a1', 'Twin ' || n, 'member', 'active'
    from generate_series(1, 2) n;
select open_year((select id from families where name = 'Split Family'), 2027);
insert into ballots (vote_id, member_id, choice_mode)
  select (select v.id from votes v join years y on y.id = v.year_id
           where y.family_id = (select id from families where name = 'Split Family')
             and v.kind = 'mode'),
         member_of('Twin 1'), 'shared';
insert into ballots (vote_id, member_id, choice_mode)
  select (select v.id from votes v join years y on y.id = v.year_id
           where y.family_id = (select id from families where name = 'Split Family')
             and v.kind = 'mode'),
         member_of('Twin 2'), 'personal';
select close_window('Split Family');
select resolve_center_vote(
  (select id from years where family_id = (select id from families where name = 'Split Family')));
select is(
  (select center_mode from years
    where family_id = (select id from families where name = 'Split Family')),
  'personal', 'a tied mode vote resolves to personal (§8.3)');

-- Shared wins, but nobody proposed anything.
select create_family('Unproposed Family', 'UTC');
insert into members (family_id, guardian_account_id, display_name, role, status)
  values ((select id from families where name = 'Unproposed Family'),
          '00000000-0000-4000-8000-0000000000a1', 'Lone', 'member', 'active');
select open_year((select id from families where name = 'Unproposed Family'), 2027);
insert into ballots (vote_id, member_id, choice_mode)
  select (select v.id from votes v join years y on y.id = v.year_id
           where y.family_id = (select id from families where name = 'Unproposed Family')
             and v.kind = 'mode'),
         member_of('Lone'), 'shared';
select close_window('Unproposed Family');
select resolve_center_vote(
  (select id from years where family_id = (select id from families where name = 'Unproposed Family')));
select is(
  (select center_mode from years
    where family_id = (select id from families where name = 'Unproposed Family')),
  'personal',
  'shared with ZERO Proposals falls back to personal — never leave the Center Tile '
  'empty or the Board unsealed (§9.3)');
select is(
  (select count(*) from family_goals fg join years y on y.id = fg.year_id
    where y.family_id = (select id from families where name = 'Unproposed Family'))::int,
  0, 'and no empty Family Goal is created');

-- The fallback moves the Center Tile, not the record of what the Family chose. The
-- Feed has to be able to say "you voted for a Family Goal but nobody proposed one";
-- writing 'personal' here would have it claim they voted the other way.
select is(
  (select v.outcome from votes v join years y on y.id = v.year_id
    where y.family_id = (select id from families where name = 'Unproposed Family')
      and v.kind = 'mode'),
  'shared',
  'the mode Vote still records SHARED — the fallback changed the centre, not the vote');

select is(
  (select v.outcome from votes v join years y on y.id = v.year_id
    where y.family_id = (select id from families where name = 'Unproposed Family')
      and v.kind = 'goal'),
  null,
  'and the goal Vote records no winner as NULL, not a sentinel — status says it is over');

-- ---------------------------------------------------------------------------------
-- Ties on the Family Goal (ADR-0007): Organizer first, then earliest Proposal
-- ---------------------------------------------------------------------------------

select create_family('Tied Family', 'UTC');
insert into members (family_id, account_id, display_name, role, status)
  values ((select id from families where name = 'Tied Family'),
          '00000000-0000-4000-8000-0000000000a2', 'Voter A', 'member', 'active');
insert into members (family_id, guardian_account_id, display_name, role, status)
  values ((select id from families where name = 'Tied Family'),
          '00000000-0000-4000-8000-0000000000a2', 'Voter B', 'member', 'active');
select open_year((select id from families where name = 'Tied Family'), 2027);

create temp table tied as select
  (select v.id from votes v join years y on y.id = v.year_id
    where y.family_id = (select id from families where name = 'Tied Family') and v.kind = 'mode') as mode_vote,
  (select v.id from votes v join years y on y.id = v.year_id
    where y.family_id = (select id from families where name = 'Tied Family') and v.kind = 'goal') as goal_vote,
  (select id from years where family_id = (select id from families where name = 'Tied Family')) as yr;

insert into ballots (vote_id, member_id, choice_mode)
  values ((select mode_vote from tied), member_of('Voter A'), 'shared');

-- Two Proposals, one vote each. "Earlier" arrives first.
insert into proposals (id, vote_id, member_id, text, created_at) values
  ('00000000-0000-4000-8000-0000000000e7', (select goal_vote from tied),
   member_of('Voter A'), 'Earlier', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000e8', (select goal_vote from tied),
   member_of('Voter B'), 'Later', now());
insert into ballots (vote_id, member_id, proposal_id) values
  ((select goal_vote from tied), member_of('Voter A'), '00000000-0000-4000-8000-0000000000e7'),
  ((select goal_vote from tied), member_of('Voter B'), '00000000-0000-4000-8000-0000000000e8');

-- The Organizer recorded a tiebreak, so it wins (PRD §9.2, api.md §7).
update votes set organizer_tiebreak_proposal_id = '00000000-0000-4000-8000-0000000000e8'
 where id = (select goal_vote from tied);

select close_window('Tied Family');
select resolve_center_vote((select yr from tied));
select is(
  (select fg.text from family_goals fg where fg.year_id = (select yr from tied)),
  'Later', 'a tie goes to the Organizer''s recorded tiebreak (§9.2)');

-- Same tie, no tiebreak recorded: the earliest Proposal decides, so the seal job never
-- waits on an Organizer who does not tap (FRONTEND_DESIGN §4.3, §8.4).
select create_family('Untied Family', 'UTC');
insert into members (family_id, guardian_account_id, display_name, role, status) values
  ((select id from families where name = 'Untied Family'),
   '00000000-0000-4000-8000-0000000000a1', 'Pick A', 'member', 'active'),
  ((select id from families where name = 'Untied Family'),
   '00000000-0000-4000-8000-0000000000a1', 'Pick B', 'member', 'active');
select open_year((select id from families where name = 'Untied Family'), 2027);

create temp table untied as select
  (select v.id from votes v join years y on y.id = v.year_id
    where y.family_id = (select id from families where name = 'Untied Family') and v.kind = 'mode') as mode_vote,
  (select v.id from votes v join years y on y.id = v.year_id
    where y.family_id = (select id from families where name = 'Untied Family') and v.kind = 'goal') as goal_vote,
  (select id from years where family_id = (select id from families where name = 'Untied Family')) as yr;

insert into ballots (vote_id, member_id, choice_mode)
  values ((select mode_vote from untied), member_of('Pick A'), 'shared');
insert into proposals (id, vote_id, member_id, text, created_at) values
  ('00000000-0000-4000-8000-0000000000f7', (select goal_vote from untied),
   member_of('Pick A'), 'First in', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000f8', (select goal_vote from untied),
   member_of('Pick B'), 'Second in', now());
insert into ballots (vote_id, member_id, proposal_id) values
  ((select goal_vote from untied), member_of('Pick A'), '00000000-0000-4000-8000-0000000000f7'),
  ((select goal_vote from untied), member_of('Pick B'), '00000000-0000-4000-8000-0000000000f8');

select close_window('Untied Family');
select resolve_center_vote((select yr from untied));
select is(
  (select fg.text from family_goals fg where fg.year_id = (select yr from untied)),
  'First in',
  'with no tiebreak recorded the EARLIEST Proposal decides, so resolution never waits '
  'on a tap that may never come (ADR-0007, §8.4)');

-- ---------------------------------------------------------------------------------
-- The boundary
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a9');

select throws_ok($$
  select cast_ballot(
    (select v.id from votes v join years y on y.id = v.year_id
      where y.family_id = (select id from families where name = 'Tied Family') and v.kind = 'mode'),
    member_of('Voter A'), 'shared')
$$, '42501', null,
  'CROSS-FAMILY: an outsider cannot cast a Ballot in another Family''s Vote');

select throws_ok($$
  select resolve_center_vote((select yr from tied))
$$, '42501', null,
  'CROSS-FAMILY: nor resolve another Family''s Center Vote');

select act_as('00000000-0000-4000-8000-0000000000a2');
select throws_ok($$
  select set_organizer_tiebreak(vote_of('goal'),
    (select id from proposals where text = 'Marathon'))
$$, '42501', null,
  'NON-ORGANIZER: an ordinary Member cannot record a tiebreak (§9.2)');

select * from finish();
rollback;
