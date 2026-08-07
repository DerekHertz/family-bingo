-- Slice 22, second half — Ready, and the early Seal.
--
-- The Setup Window "ends on a fixed date, whether or not everyone has finished"
-- (CONTEXT.md). That rule exists to stop one person's silence holding four other people
-- at the starting line, and it is not being weakened here: the date still decides, and it
-- still decides for the Organizer as much as for anyone.
--
-- What it never covered is the opposite case. A Family of four who have all written their
-- 24 Goals and all said so are not waiting on a decision — they are waiting on a
-- calendar, and in two shapes that costs them real days:
--
--   * A Year opened after 25 December has a deadline of `now + 7 days` (§5.2), so a
--     Family that opens on the 28th and finishes on the 30th cannot play until 4 January.
--     Three days of their own Year, spent watching a countdown.
--   * A Member approved in July gets a personal window of seven days (§21.1). They finish
--     their Board in an hour and then sit out a week of a Year everybody else is playing.
--
-- So the deadline becomes a **backstop rather than the only door**, and the second door
-- is unanimity: every Member says their own Board is done, and when the last one does,
-- the Boards seal. Nobody's window is shortened by anyone else — a Member who has not
-- said they are done is a Member the Family is still waiting for, and the date arrives on
-- schedule regardless. That is the inversion of §8.4 rather than a breach of it: silence
-- cannot *block* an outcome, and here it cannot *cause* one either.
--
-- **Ready is declared, never inferred.** The obvious implementation is to watch for the
-- 24th Goal appearing and seal when the last Board fills. It is wrong: §6.4 makes a draft
-- Board freely editable, and people write all 24 and then spend three days rewording
-- them. Inferring readiness from a full Board means the last person to type their last
-- Goal instantly and silently seals four Boards, and undoing a typo afterwards costs a
-- Swap (§18.5). A full Board is what makes the control *available*; the tap is what makes
-- it true, and it can be taken back until it is the last one.
--
-- What Ready explicitly does NOT wait for is a complete Center Vote. Ballots are
-- changeable until the Setup Window closes (§8.1) and not casting one is an abstention
-- (§8.2) — so requiring everyone to have voted before the Family could finish would hand
-- exactly the veto §8.4 removes back to the quietest person in the Family. Marking Ready
-- is the moment a Member's Ballot becomes final, and the client says so before the tap.

alter table boards add column ready_at timestamptz;

comment on column boards.ready_at is
  'When the Member said this Board is done (PRD §22). Declared, never inferred from a '
  'full Board — see the migration comment. Revocable until it is the last one: once '
  'every Board in the Year is ready they all seal, and `sealed_at` is what refuses to '
  'move afterwards.';

-- ---------------------------------------------------------------------------------
-- The two questions Ready is made of
-- ---------------------------------------------------------------------------------

-- Whether there is a Goal on every square a Member authors.
--
-- Twenty-four, not twenty-five. Position 12 is the Centre and belongs to the Family until
-- the vote resolves (§6.5); in personal mode the Member writes it in the seven days
-- *after* the seal (§9.5, migration 17), so a Board with an empty Tile 12 is complete in
-- the only sense its owner can act on. Mirrored by `boardIsComplete()` in
-- src/domain/ready.ts — if you change one, change both.
--
-- Counted rather than asked as `not exists (… goal_id is null)`, which is the same fail-
-- open shape as `every()` over an empty array: it answers **true** for a Board id that
-- names nothing and for a Board whose Tiles are missing. `ensure_board()` and the 25-Tile
-- invariant make both unreachable today, and the client's copy fails shut for exactly this
-- reason — a predicate whose wrong answer seals four other people's Boards should not rely
-- on an invariant enforced two migrations away.
create or replace function board_is_complete(target_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*) from tiles t
     where t.board_id = target_board_id
       and t.position <> 12
       and t.goal_id is not null
  ) = 24;
$$;

comment on function board_is_complete(uuid) is
  'PRD §22.2 — every one of the 24 authorable squares holds a Goal. Position 12 is '
  'excluded because it is never the Member''s to fill during the Setup Window (§6.5).';

-- Whether every Board still to seal in this Year has been declared ready.
--
-- Only active Members count. A pending Member has no Board (§3.2, open_year) so cannot
-- appear here, and one whose Board has already sealed cannot be waited on — which is what
-- makes this safe to ask of a Year that is halfway through sealing.
--
-- The `exists` guard is not defensive tidiness. Without it a Year with no Boards at all
-- satisfies "no Board is unready" vacuously and seals itself the moment it is opened.
--
-- **`ready_at` is asked alongside `board_is_complete()`, not instead of it.** A declaration
-- can go stale: §6.4 keeps a draft freely editable after the tap, and `clear_goal()`
-- empties a square. Clearing now withdraws the declaration too (see the bottom of this
-- migration) — this is the belt to that pair of braces, and it is the one that matters,
-- because the failure it prevents is silent and permanent. A Board that is ready and no
-- longer full would otherwise be sealed by the NEXT Member's tap with an empty square on
-- it, and §18.5 prices getting that square back at a Swap. The whole "declared, never
-- inferred" argument at the top of this file is worth nothing if the declaration is
-- allowed to outlive the thing it was about.
--
-- This is only the EARLY door. §10.2 is untouched: at the deadline an unfinished Board
-- still seals with empty Tiles rather than holding the Family up.
create or replace function year_is_ready(target_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from boards b where b.year_id = target_year_id
         )
     and not exists (
           select 1
             from boards b
             join members m on m.id = b.member_id
            where b.year_id = target_year_id
              and b.sealed_at is null
              and m.status = 'active'
              and (b.ready_at is null or not board_is_complete(b.id))
         );
$$;

comment on function year_is_ready(uuid) is
  'PRD §22.3 — every Member of this Year has said their Board is done AND still has a '
  'Goal on every square. The second door into the seal; `setup_deadline` is the first and '
  'remains the backstop, and §10.2 still seals an unfinished Board when it arrives.';

-- ---------------------------------------------------------------------------------
-- Sealing, split into the decision and the act
-- ---------------------------------------------------------------------------------
--
-- There are now two authorities that can seal a Year and they are not the same shape.
-- The deadline is a clock and answers to `pg_cron` or the Organizer; unanimity answers to
-- whoever happened to tap Ready last, who is usually neither. Leaving one function to
-- serve both would mean `mark_board_ready()` calling a function that asks whether the
-- caller is the Organizer — and refusing four out of five Families.
--
-- So the guards live in `seal_year()` and the act lives here. Nothing calls this that has
-- not already established the right to.

-- The Center Vote resolved on the authority of the caller rather than the clock.
--
-- Split out of `resolve_center_vote()` for the same reason: that function refuses to run
-- before `closes_at`, deliberately and with a comment saying why, and an early seal has
-- to do the one thing it forbids. The forbidding is intact — `resolve_center_vote()` is
-- unchanged and still refuses an Organizer who taps it on day one. This is reachable only
-- from inside a seal that has already been justified.
create or replace function resolve_center_vote_now(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr               years;
  mode_vote        votes;
  goal_vote        votes;
  shared_ballots   int;
  personal_ballots int;
  -- Two different facts, and conflating them is how the audit row starts lying.
  -- `voted_mode` is what the Family chose; `resolved_mode` is what the Center Tile
  -- actually became after §9.3's fallback. They differ when a Family votes shared and
  -- then nobody proposes anything.
  voted_mode       text;
  resolved_mode    text;
  winner           proposals;
  created_goal     family_goals;
begin
  select * into yr from years where id = resolve_center_vote_now.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
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
    into shared_ballots, personal_ballots
    from ballots where ballots.vote_id = mode_vote.id;

  voted_mode := case when shared_ballots > personal_ballots then 'shared' else 'personal' end;
  resolved_mode := voted_mode;

  if resolved_mode = 'shared' then
    -- §9.2: a plurality of the Ballots cast. Among tied leaders the Organizer's
    -- tiebreak wins if they recorded one, and the earliest Proposal decides if they
    -- did not (ADR-0007) — the fallback is what lets this run unattended.
    --
    -- A Ballot for a Proposal that no longer exists is discarded by the join, not
    -- counted against anyone.
    with tally as (
      select p.id, p.created_at,
             count(b.id) as ballot_count
        from proposals p
        left join ballots b
          on b.proposal_id = p.id and b.vote_id = goal_vote.id
       where p.vote_id = goal_vote.id
       group by p.id, p.created_at
    )
    select p.* into winner
      from tally t join proposals p on p.id = t.id
     where t.ballot_count = (select max(ballot_count) from tally)
     order by (t.id = goal_vote.organizer_tiebreak_proposal_id) desc,
              t.created_at asc,
              t.id asc
     limit 1;

    -- §9.3: zero Proposals falls back to personal. Never leave the Center Tile empty
    -- or the Board unsealed.
    --
    -- Only `resolved_mode` moves. `voted_mode` still says shared, because that is what
    -- the Family voted, and the Feed has to be able to say "you chose a Family Goal but
    -- nobody proposed one" rather than pretending the vote went the other way.
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

  -- The mode Vote records what was VOTED, not what the centre became — see §9.3 above.
  --
  -- `closes_at` moves to now() on an early resolution, and that is a correction rather
  -- than bookkeeping: the Vote IS closed, and leaving a future date on a resolved row
  -- would have the app counting down to a deadline that had already passed in every
  -- sense that matters. `enforce_proposal_rules()` and `cast_ballot()` both read
  -- `status = 'resolved' or now() >= closes_at`, so neither depended on this — the
  -- screens did.
  update votes
     set status = 'resolved',
         resolved_at = now(),
         closes_at = least(closes_at, now()),
         outcome = case when votes.kind = 'mode' then voted_mode
                        else winner.id::text end
   where votes.year_id = yr.id;

  return yr;
end;
$$;

-- `resolve_center_vote()` keeps every guard it had and delegates the body. The deadline
-- check stays exactly as strict: an Organizer calling this directly still cannot end the
-- Family's vote early, whatever the Boards say.
create or replace function resolve_center_vote(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr        years;
  mode_vote votes;
  goal_vote votes;
begin
  select * into yr from years where id = resolve_center_vote.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  perform assert_cron_or_organizer(yr.family_id, 'resolve the Center Vote');

  if yr.center_mode <> 'undecided' then
    return yr;
  end if;

  select * into mode_vote from votes where votes.year_id = yr.id and kind = 'mode';
  select * into goal_vote from votes where votes.year_id = yr.id and kind = 'goal';

  -- §8.1: "Ballots are changeable until the deadline." Resolving early takes that back
  -- and cannot be undone — cast_ballot() refuses a resolved Vote, and the early return
  -- above means a second call will not reopen it. So an Organizer who tapped this on
  -- day one would end the Family's vote for everyone, silently and permanently.
  --
  -- The Family finishing early is the one thing that legitimately overrides this, and it
  -- does not come through here: mark_board_ready() reaches resolve_center_vote_now()
  -- inside a seal, where every Member has just said they are done.
  if now() < greatest(mode_vote.closes_at, goal_vote.closes_at) then
    raise exception 'the Setup Window is still open' using errcode = 'PT403';
  end if;

  return resolve_center_vote_now(yr.id);
end;
$$;

-- Seal every Board in a Year. No guards: the caller has established the right.
--
-- `for update` on the Year is what makes the two doors safe to have open at once. Two
-- Members tapping Ready in the same second both see a ready Year, and without the lock
-- both would run `deal_positions()` over the same Boards — the second one re-shuffling
-- Goals that the first had already laid out, which is the one operation migration 34
-- says is safe only at the seal and never twice.
create or replace function seal_year_now(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr    years;
  b_id  uuid;
begin
  select * into yr from years where id = seal_year_now.year_id for update;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  -- §10.4. Whoever lost the race above arrives here and leaves without touching
  -- anything, which is also what makes a cron retry after a partial failure free.
  if yr.sealed_at is not null then
    return yr;
  end if;

  perform resolve_center_vote_now(yr.id);

  -- Deal only the Boards this call is about to seal, and deal them before they seal.
  -- Same transaction either way, but the order says what is true: a Board's squares are
  -- laid out as it seals, and a Board that was already sealed is never laid out again.
  for b_id in
    select b.id from boards b where b.year_id = yr.id and b.sealed_at is null
  loop
    perform deal_positions(b_id);
  end loop;

  -- §10.2: whether or not authoring finished. Still true on this path even though every
  -- Board that caused it is full — a Member approved into the Setup Window an hour ago
  -- has an empty Board, no ready_at, and is exactly who year_is_ready() is waiting for.
  update boards b
     set sealed_at = now()
   where b.year_id = yr.id
     and b.sealed_at is null;

  update years
     set status = 'active', sealed_at = now()
   where id = yr.id
  returning * into yr;

  return yr;
end;
$$;

-- Seal one Board on its own clock: §21.1's late joiner, whose window is personal and
-- whose Year is already under way. Both callers used to inline this, which is how the
-- straggler sweep nearly shipped without `deal_positions()` (migration 34).
create or replace function seal_board_now(board_id uuid)
returns boards
language plpgsql
security definer
set search_path = public
as $$
declare
  b boards;
begin
  select * into b from boards where id = seal_board_now.board_id for update;
  if b.id is null then
    raise exception 'no such Board' using errcode = '42501';
  end if;

  if b.sealed_at is not null then
    return b;
  end if;

  perform deal_positions(b.id);

  update boards set sealed_at = now() where id = b.id returning * into b;
  return b;
end;
$$;

create or replace function seal_year(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr years;
begin
  select * into yr from years where id = seal_year.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  perform assert_cron_or_organizer(yr.family_id, 'seal a Year');

  -- §10.4, checked before the guard below so re-running is always harmless.
  if yr.sealed_at is not null then
    return yr;
  end if;

  -- Two doors, and only two. The date, which arrives for everyone at once; or every
  -- Member having said their own Board is done. An Organizer with neither is still
  -- refused, and refused in the same words as before — sealing early on their own
  -- authority would take authoring time away from everyone else, silently, with no
  -- appeal.
  if now() < yr.setup_deadline and not year_is_ready(yr.id) then
    raise exception 'the Setup Window is still open' using errcode = 'PT403';
  end if;

  return seal_year_now(yr.id);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Saying you are done, and taking it back
-- ---------------------------------------------------------------------------------

-- Mark this Board done, and seal if that was the last one.
--
-- One RPC does both because they are one act from the Member's side, and because the
-- alternative — a client that marks ready, re-reads the Year, and calls seal when it
-- looks unanimous — puts the decision in four racing clients instead of one transaction.
--
-- Three refusals, three SQLSTATEs. A sealed Board, an incomplete Board and someone
-- else's Board are different enough that one code covering all three would leave the
-- client guessing, which is how `writeGoalFailureCopy`'s centre branch died (HANDOFF,
-- open item 8). The client discriminates before the request anyway — it knows whether
-- the Board is full — and this is the backstop.
create or replace function mark_board_ready(board_id uuid)
returns boards
language plpgsql
security definer
set search_path = public
as $$
declare
  b  boards;
  yr years;
begin
  select * into b from boards where id = mark_board_ready.board_id;
  if b.id is null then
    raise exception 'no such Board' using errcode = '42501';
  end if;

  -- A Guardian marking a Managed Member's Board done is the normal case (§4.2), which is
  -- why this checks the Member rather than the Account.
  if b.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Board' using errcode = '42501';
  end if;

  -- **The Year is locked before the declaration is written, not after.** Two things turn
  -- on the order and both were wrong the first time.
  --
  -- Unanimity is a question about every Board in the Year, and asking it from inside an
  -- uncommitted transaction that has just written one of the answers is only sound if
  -- nobody else is doing the same. Under READ COMMITTED two Members tapping Ready in the
  -- same second each saw the other's `ready_at` as NULL, both concluded the Family was not
  -- finished, and **nothing sealed** — the Family sat watching a countdown until the
  -- five-minute sweep noticed. Taking the lock here serializes the pair: the second one
  -- waits, and `year_is_ready()` below is a fresh statement, so it sees the first
  -- Member's committed row.
  --
  -- And it fixes a deadlock. `seal_year_now()` locks `years` and then updates `boards`;
  -- this function used to update `boards` and then reach `years`, which is the textbook
  -- cycle — cron and a Member tapping at once deadlocked, one of them lost, and the
  -- `exception` handler below swallowed it into the same five-minute wait. Every path now
  -- takes `years` first.
  --
  -- After the ownership check, deliberately: a lock is a small denial-of-service, and
  -- nobody outside the Family gets to take one.
  select * into yr from years where id = b.year_id for update;

  if yr.frozen_at is not null then
    raise exception 'this Year is frozen' using errcode = '42501';
  end if;

  if b.sealed_at is not null then
    raise exception 'this Board has already sealed' using errcode = 'PT403';
  end if;

  if not board_is_complete(b.id) then
    raise exception 'every square needs a Goal before a Board is done'
      using errcode = 'PT409';
  end if;

  -- Idempotent, and the timestamp does not move on a second call: "when this Member
  -- finished" is a fact about them, not about how many times they tapped.
  if b.ready_at is null then
    update boards set ready_at = now() where id = b.id returning * into b;
  end if;

  -- **The seal is a consequence, and must not be able to undo the declaration.** Ready
  -- is the Member's act and theirs alone; sealing is the Family's, it involves every
  -- other Board in the Year, and it is retried every five minutes by the sweep. Letting
  -- a failure in the second roll back the first would tell a Member their tap did not
  -- register — for a reason that has nothing to do with them and that they cannot act
  -- on. The block below is a savepoint: the warning goes to the log, `ready_at` stands,
  -- and `seal_due_boards()` tries again shortly.
  begin
    if yr.sealed_at is null then
      if year_is_ready(yr.id) then
        perform seal_year_now(yr.id);
      end if;
    else
      -- The Year is already under way, so this is §21.1's late joiner and the only Board
      -- involved is theirs. Nobody else's window is touched and the Centre was decided
      -- months ago (§21.2) — there is nothing to wait for and a week of their own Year
      -- to lose by waiting.
      perform seal_board_now(b.id);
    end if;
  exception when others then
    raise warning 'sealing after mark_board_ready(%) failed: %', b.id, sqlerrm;
  end;

  select * into b from boards where id = b.id;
  return b;
end;
$$;

-- Take it back. Only until it was the last one — after that `sealed_at` is set and the
-- Board is a commitment (CONTEXT.md, Sealing), which is the same door every other edit
-- meets.
create or replace function clear_board_ready(board_id uuid)
returns boards
language plpgsql
security definer
set search_path = public
as $$
declare
  b  boards;
  yr years;
begin
  select * into b from boards where id = clear_board_ready.board_id;
  if b.id is null then
    raise exception 'no such Board' using errcode = '42501';
  end if;

  if b.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Board' using errcode = '42501';
  end if;

  -- The same first guard as mark_board_ready, and not symmetry for its own sake: a Board
  -- can be unsealed inside a frozen Year. `freeze_year()` does not seal outstanding
  -- Boards, and a Member approved on 28 December has a `personal_setup_deadline` clamped
  -- to the Freeze — so if their seal was swallowed by the handler above, they arrive in a
  -- frozen Year holding a `ready_at` and no `sealed_at`. §20.1 says a frozen Year is
  -- permanently read-only, and this is a write to it.
  select * into yr from years where id = b.year_id;
  if yr.frozen_at is not null then
    raise exception 'this Year is frozen' using errcode = '42501';
  end if;

  if b.sealed_at is not null then
    raise exception 'this Board has already sealed' using errcode = 'PT403';
  end if;

  update boards set ready_at = null where id = b.id returning * into b;
  return b;
end;
$$;

-- Emptying a square withdraws the declaration that went with it.
--
-- §6.4 keeps a draft freely editable and §22.4 makes Ready revocable, and the two meet
-- here: a Member who has said they are done and then goes back to reword a square has
-- stopped being done, whether or not they thought about it in those terms. Without this
-- the declaration outlives the Board it described — the Family stays "everyone is done",
-- the next Member's tap seals this Board with an empty square, and §18.5 prices getting
-- it back at a Swap. Silent, permanent, and caused by an edit the app openly invites.
--
-- `write_goal()` deliberately does NOT do this. Rewording a square, or replacing its Goal,
-- leaves twenty-four squares full — the Board is still exactly what its owner declared,
-- and withdrawing the declaration for a typo fix would make Ready feel like a trap.
-- Only *losing* a square changes the answer.
--
-- The rest of the body is migration 13's, unchanged.
create or replace function clear_goal(tile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tile  tiles;
  board boards;
  old_goal uuid;
begin
  select * into tile from tiles t where t.id = clear_goal.tile_id;
  if tile.id is null then
    raise exception 'no such Tile' using errcode = '42501';
  end if;

  select * into board from boards b where b.id = tile.board_id;

  if board.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Board' using errcode = '42501';
  end if;

  if board.sealed_at is not null then
    raise exception 'this Board is sealed — clearing a Goal now costs a Swap'
      using errcode = 'PT403';
  end if;

  old_goal := tile.goal_id;
  update tiles set goal_id = null where id = tile.id;
  if old_goal is not null then
    delete from goals where id = old_goal;
  end if;

  -- §22.4. Unconditional rather than guarded on `old_goal`: clearing an already-empty
  -- square is a no-op on the Tiles and this is a no-op on a Board that was not ready.
  update boards set ready_at = null where id = board.id and ready_at is not null;
end;
$$;

-- ---------------------------------------------------------------------------------
-- The sweep, which now has a second reason to seal
-- ---------------------------------------------------------------------------------
--
-- Unanimity seals synchronously inside mark_board_ready(), so in the ordinary case this
-- finds nothing new. It matters for the case that is not ordinary: the savepoint above
-- swallowed a failure, or a Board's Member was approved and then the last straggler
-- marked ready in a transaction that rolled back for an unrelated reason. A Year that is
-- ready and unsealed is a Family staring at a countdown that should already have ended,
-- and five minutes is the longest that can now last.
create or replace function seal_due_boards()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  due            years;
  sealed         int := 0;
  this_year      int;
  straggler_ids  uuid[];
  b_id           uuid;
begin
  for due in
    select * from years
     where status = 'setup'
       and (now() >= setup_deadline or year_is_ready(id))
     order by setup_deadline
  loop
    begin
      -- Not seal_year(): `pg_cron` has no JWT so the Organizer guard would pass, but the
      -- deadline guard would refuse every ready Year that is still inside its window —
      -- which is the entire reason this loop now selects them.
      perform seal_year_now(due.id);
      -- The loop only ever sees a Year in 'setup', which has never been sealed, so
      -- every sealed Board it now has was sealed by the call above.
      select count(*) into this_year from boards b
       where b.year_id = due.id and b.sealed_at is not null;
      sealed := sealed + this_year;
    exception when others then
      raise warning 'seal_year_now(%) failed: %', due.id, sqlerrm;
    end;
  end loop;

  -- §21.1's late joiners, sealed one at a time — as their own windows close, or as they
  -- say they are done, whichever comes first. Collected first so the ids survive the
  -- UPDATE that seal_board_now() performs.
  select array_agg(b.id) into straggler_ids
    from boards b
    join years y on y.id = b.year_id
   where y.sealed_at is not null
     and y.frozen_at is null
     and b.sealed_at is null
     and b.personal_setup_deadline is not null
     and (now() >= b.personal_setup_deadline or b.ready_at is not null);

  if straggler_ids is null then
    return sealed;
  end if;

  foreach b_id in array straggler_ids loop
    perform seal_board_now(b_id);
  end loop;

  return sealed + array_length(straggler_ids, 1);
end;
$$;

-- Both predicates stay server-side. They are SECURITY DEFINER — they have to be, to see
-- a sibling's Tiles while deciding whether the Family is unanimous — so granting them
-- would answer "is that Board finished?" about any Board id in the database, RLS and
-- Family boundary included. The screens need the same two answers and compute them from
-- rows they can already read: `boardIsComplete()` and `readiness()` in
-- src/domain/ready.ts, over the Tiles and Boards the caller is entitled to.
revoke execute on function board_is_complete(uuid) from public, anon, authenticated;
revoke execute on function year_is_ready(uuid) from public, anon, authenticated;
revoke execute on function resolve_center_vote_now(uuid) from public, anon, authenticated;
revoke execute on function seal_year_now(uuid) from public, anon, authenticated;
revoke execute on function seal_board_now(uuid) from public, anon, authenticated;

revoke execute on function mark_board_ready(uuid) from public, anon;
revoke execute on function clear_board_ready(uuid) from public, anon;
grant execute on function mark_board_ready(uuid) to authenticated;
grant execute on function clear_board_ready(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- A door that was already open, and that this slice walks past twice
-- ---------------------------------------------------------------------------------
--
-- `deal_positions()` is SECURITY DEFINER and migration 34 never revoked it, so it kept
-- PostgREST's default PUBLIC EXECUTE — meaning any signed-in Account could POST
-- `/rest/v1/rpc/deal_positions` with **any Board id in the database** and permute that
-- Board's `goal_id`s. Migration 34's own comment says the operation is "safe only at the
-- seal" and "would not be safe one moment later", and it is right about why: after the
-- seal the Tiles carry Increments, Milestones and Revisions, and moving `goal_id` between
-- them silently reassigns a year of somebody's progress to different Goals.
--
-- Not introduced here — it is on `main` — but §22 adds a second path into sealing and
-- makes this function more load-bearing rather than less, and a one-line revoke is not
-- worth deferring to a slice of its own.
--
-- `board_positions()` and `dealt_position()` stay reachable: both are pure functions of a
-- uuid that compute where a Board's squares *would* land, they write nothing, and
-- `supabase/tests` reads them.
revoke execute on function deal_positions(uuid) from public, anon, authenticated;
