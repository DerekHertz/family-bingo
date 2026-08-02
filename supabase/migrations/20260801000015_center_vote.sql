-- Slices 8 and 9, server half — the Center Vote.
--
-- These functions are the SQL half of src/domain/votes.ts. The TypeScript is what the
-- app shows a Family while the Setup Window is open; this is what actually decides the
-- Center Tile, because `pg_cron` resolves the vote on a deadline with no client
-- involved. If you change one, change both.
--
-- The governing rule is PRD §8.4: **never blockable by inaction.** No quorum, no
-- unanimity, no waiting on a non-voter. In any family of five or more at least one
-- person is a lurker, and their silence must not freeze four other people's Boards.
-- Every path below terminates in an outcome.

-- Where the Organizer's tiebreak lives until the vote resolves (§9.2, ADR-0007).
alter table votes add column organizer_tiebreak_proposal_id uuid
  references proposals (id) on delete set null;

-- §9.1: max 3 Proposals each. A CHECK cannot count sibling rows, so this is a trigger —
-- and it is a trigger rather than an RPC guard because `proposals` is one of the two
-- tables the client writes directly (schema.md §4.2).
create or replace function enforce_proposal_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from proposals p
       where p.vote_id = new.vote_id and p.member_id = new.member_id) >= 3 then
    raise exception 'a Member may put forward at most 3 Proposals' using errcode = 'PT409';
  end if;
  return new;
end;
$$;

create trigger proposals_enforce_limit
  before insert on proposals
  for each row execute function enforce_proposal_limit();

-- Cast or change a Ballot (§8.1).
--
-- Changing a vote is an UPDATE, not a second row — the UNIQUE (vote_id, member_id)
-- constraint is what makes that true, and this upsert is what makes it convenient.
-- Ballots stay changeable right up to the deadline; moving a vote writes no Feed row
-- (FRONTEND_DESIGN §4.3).
create or replace function cast_ballot(
  vote_id     uuid,
  member_id   uuid,
  choice_mode text default null,
  proposal_id uuid default null
)
returns ballots
language plpgsql
security definer
set search_path = public
as $$
declare
  v      votes;
  cast_by ballots;
begin
  select * into v from votes where id = cast_ballot.vote_id;
  if v.id is null or family_of_vote(v.id) is distinct from family_of_member(cast_ballot.member_id) then
    raise exception 'no such Vote' using errcode = '42501';
  end if;

  if cast_ballot.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Member' using errcode = '42501';
  end if;

  if v.status = 'resolved' or now() >= v.closes_at then
    raise exception 'the Setup Window has closed' using errcode = 'PT403';
  end if;

  -- A mode Ballot picks a mode; a goal Ballot picks a Proposal. The CHECK on `ballots`
  -- enforces exactly-one-of; this makes sure the one supplied is the one this Vote wants.
  if v.kind = 'mode' then
    -- `null not in (...)` evaluates to NULL, not true, so the NULL case has to be
    -- named explicitly — otherwise a mode Ballot sent with a Proposal falls through to
    -- the CHECK constraint and the caller gets an opaque 23514 instead of a reason.
    if cast_ballot.choice_mode is null
       or cast_ballot.choice_mode not in ('shared', 'personal') then
      raise exception 'a mode Ballot must choose shared or personal' using errcode = '22023';
    end if;
    cast_ballot.proposal_id := null;
  else
    if cast_ballot.proposal_id is null
       or not exists (select 1 from proposals p
                       where p.id = cast_ballot.proposal_id and p.vote_id = v.id) then
      raise exception 'a goal Ballot must choose a Proposal from this Vote'
        using errcode = '22023';
    end if;
    cast_ballot.choice_mode := null;
  end if;

  -- ON CONFLICT names the CONSTRAINT rather than the columns. The column-inference
  -- form resolves bare names against plpgsql variables first, so `(vote_id, member_id)`
  -- would bind to this function's parameters instead of the index — and the parameters
  -- are named for the client contract, not for Postgres's convenience.
  insert into ballots (vote_id, member_id, choice_mode, proposal_id)
  values (cast_ballot.vote_id, cast_ballot.member_id,
          cast_ballot.choice_mode, cast_ballot.proposal_id)
  on conflict on constraint one_ballot_per_member do update
    set choice_mode = excluded.choice_mode,
        proposal_id = excluded.proposal_id,
        updated_at  = now()
  returning * into cast_by;

  return cast_by;
end;
$$;

-- The Organizer's tiebreak (§9.2). Recorded ahead of resolution rather than applied at
-- resolution time, because `pg_cron` resolves on a deadline and cannot stop to ask.
create or replace function set_organizer_tiebreak(vote_id uuid, proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v votes;
begin
  select * into v from votes where id = set_organizer_tiebreak.vote_id;
  if v.id is null or not is_organizer_of(family_of_vote(v.id)) then
    raise exception 'only the Organizer may break a tie' using errcode = '42501';
  end if;
  if set_organizer_tiebreak.proposal_id is not null
     and not exists (select 1 from proposals p
                      where p.id = set_organizer_tiebreak.proposal_id and p.vote_id = v.id) then
    raise exception 'that Proposal is not in this Vote' using errcode = '22023';
  end if;

  update votes set organizer_tiebreak_proposal_id = set_organizer_tiebreak.proposal_id
   where id = set_organizer_tiebreak.vote_id;
end;
$$;

-- Resolve the Center Vote and write the outcome onto every Board.
--
-- Idempotent and safe to re-run: a Year whose centre is already decided returns
-- unchanged. `pg_cron` calls this at the Setup Window deadline, immediately before
-- sealing (api.md §7).
create or replace function resolve_center_vote(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr             years;
  mode_vote      votes;
  goal_vote      votes;
  shared_votes   int;
  personal_votes int;
  resolved_mode  text;
  winner         proposals;
  created_goal   family_goals;
begin
  select * into yr from years where id = resolve_center_vote.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  -- auth.uid() is NULL when pg_cron calls this; a signed-in caller must be the Organizer.
  if auth.uid() is not null and not is_organizer_of(yr.family_id) then
    raise exception 'only the Organizer may resolve the Center Vote' using errcode = '42501';
  end if;

  -- Already decided. Re-running must not re-open a Family's centre.
  if yr.center_mode <> 'undecided' then
    return yr;
  end if;

  select * into mode_vote from votes where votes.year_id = yr.id and kind = 'mode';
  select * into goal_vote from votes where votes.year_id = yr.id and kind = 'goal';

  -- §8.2: a majority of the Ballots CAST. Non-voters are abstentions, not blockers.
  -- §8.3: a tie, or zero Ballots, resolves to personal — the outcome that needs no
  -- further coordination.
  select count(*) filter (where choice_mode = 'shared'),
         count(*) filter (where choice_mode = 'personal')
    into shared_votes, personal_votes
    from ballots where ballots.vote_id = mode_vote.id;

  resolved_mode := case when shared_votes > personal_votes then 'shared' else 'personal' end;

  if resolved_mode = 'shared' then
    -- §9.2: a plurality of the Ballots cast. Among tied leaders the Organizer's
    -- tiebreak wins if they recorded one, and the earliest Proposal decides if they
    -- did not (ADR-0007) — the fallback is what lets this run unattended.
    --
    -- A Ballot for a Proposal that no longer exists is discarded by the join, not
    -- counted against anyone.
    with tally as (
      select p.id, p.created_at,
             count(b.id) as votes
        from proposals p
        left join ballots b
          on b.proposal_id = p.id and b.vote_id = goal_vote.id
       where p.vote_id = goal_vote.id
       group by p.id, p.created_at
    )
    select p.* into winner
      from tally t join proposals p on p.id = t.id
     where t.votes = (select max(votes) from tally)
     order by (t.id = goal_vote.organizer_tiebreak_proposal_id) desc,
              t.created_at asc,
              t.id asc
     limit 1;

    -- §9.3: zero Proposals falls back to personal. Never leave the Center Tile empty
    -- or the Board unsealed.
    if winner.id is null then
      resolved_mode := 'personal';
    end if;
  end if;

  if resolved_mode = 'shared' then
    insert into family_goals (year_id, text)
    values (yr.id, winner.text)
    returning * into created_goal;

    -- §9.4: the same family_goal_id onto every Board's Tile 12. One row referenced by
    -- every Board is what makes completing it complete for everyone at once (§12.3).
    update tiles t
       set family_goal_id = created_goal.id, goal_id = null
      from boards b
     where b.id = t.board_id and b.year_id = yr.id and t.position = 12;
  end if;

  update years set center_mode = resolved_mode where id = yr.id returning * into yr;

  update votes
     set status = 'resolved',
         resolved_at = now(),
         outcome = case when votes.kind = 'mode' then resolved_mode
                        else coalesce(winner.id::text, 'none') end
   where votes.year_id = yr.id;

  return yr;
end;
$$;

revoke execute on function cast_ballot(uuid, uuid, text, uuid) from public, anon;
revoke execute on function set_organizer_tiebreak(uuid, uuid) from public, anon;
revoke execute on function resolve_center_vote(uuid) from public, anon;
revoke execute on function enforce_proposal_limit() from public, anon, authenticated;

grant execute on function cast_ballot(uuid, uuid, text, uuid) to authenticated;
grant execute on function set_organizer_tiebreak(uuid, uuid) to authenticated;
grant execute on function resolve_center_vote(uuid) to authenticated;
