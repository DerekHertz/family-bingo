-- Slice 22, first half — Sealing stops meaning "the Year has begun".
--
-- Until now those were one fact wearing one column. `boards.sealed_at` closed authoring
-- AND opened play, because the two genuinely happened at the same instant: the Setup
-- Window ended at midnight on 1 January (§5.2) and the seal sweep ran there and only
-- there. Nothing had to distinguish them, so nothing did.
--
-- Slice 22 lets a Family finish early (see the next migration), and the moment it can,
-- the conflation is a bug rather than a simplification. A Family that seals on 20
-- December would start logging Increments toward the next Year in the middle of this
-- one: `remaining_year_fraction()` would be measuring a Year that had not begun, Wrapped
-- would hand "biggest month" to December, and `pace_hint` — "about 12 a month" — would
-- describe a schedule nobody could be behind on yet.
--
-- So the two facts get two columns. `sealed_at` keeps its meaning exactly: the Board is
-- a commitment now, and changing it costs a Swap. `play_opens_at` is the new one: when
-- the Year it belongs to actually starts. Everything that meant "the Year is under way"
-- and read `sealed_at` for it now reads both.
--
-- For every Year that exists today the two are the same instant to within five minutes,
-- which is why this migration changes no observable behaviour on its own. That is the
-- point of landing it separately: if a suite goes red here, the model is wrong, not the
-- feature.

-- ---------------------------------------------------------------------------------
-- When a Year starts
-- ---------------------------------------------------------------------------------
--
-- Midnight on 1 January in the Family's timezone (§8.3 T3) — the same instant
-- `setup_deadline_for()` already computed as its first term and then buried inside a
-- `greatest()`. Naming it is most of this migration: the deadline is *derived* from the
-- start of the Year, and reading them as one thing is what let the conflation stand.
--
-- `freeze_instant(y, z)` is this same boundary a year later, and the two agree by
-- construction: a Year opens where the previous one froze, with no gap and no overlap.
create or replace function year_starts_at(calendar_year int, zone text)
returns timestamptz
language sql
stable
as $$
  select (make_timestamp(calendar_year, 1, 1, 0, 0, 0) at time zone zone)
$$;

comment on function year_starts_at(int, text) is
  'PRD §5.2 and §8.3 T3 — midnight on 1 January in the Family''s timezone, which is when '
  'play opens whatever date the Boards sealed on. freeze_instant(y - 1, z) is the same '
  'instant: a Year opens exactly where the previous one froze.';

-- §5.2 unchanged, said in terms of the fact it was already computing.
create or replace function setup_deadline_for(calendar_year int, timezone text, opened_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select greatest(
    year_starts_at(calendar_year, timezone),
    opened_at + interval '7 days'
  );
$$;

-- ---------------------------------------------------------------------------------

alter table years add column play_opens_at timestamptz;

-- Every existing Year, from its own Family's timezone. Not from `setup_deadline`: those
-- agree only when the Year was opened more than seven days out, and a Family that opened
-- 2026 on 28 December has a deadline of 4 January and a Year that began on the 1st.
update years y
   set play_opens_at = year_starts_at(y.calendar_year, f.timezone)
  from families f
 where f.id = y.family_id;

-- Derived, so nothing is asked to remember it.
--
-- `play_opens_at` is a pure function of two columns that already exist — the Year's
-- `calendar_year` and its Family's timezone — and the only reason it is stored at all is
-- that half the predicates in this migration would otherwise need a `families` join to
-- ask what day it is. A stored copy of a derived fact is a chance to disagree, and a
-- NOT NULL column that every caller has to populate by hand is a chance to forget: the
-- trigger closes both. An explicit value still wins, which is what lets a test build a
-- Family whose Year began in the past without rewriting its timezone.
create or replace function stamp_play_opens_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.play_opens_at := coalesce(
    new.play_opens_at,
    year_starts_at(new.calendar_year,
                   (select f.timezone from families f where f.id = new.family_id))
  );
  return new;
end;
$$;

create trigger years_stamp_play_opens_at
  before insert on years
  for each row execute function stamp_play_opens_at();

alter table years alter column play_opens_at set not null;

comment on column years.play_opens_at is
  'When play opens: midnight on 1 January in the Family''s timezone (PRD §5.2, §11.5). '
  'NOT the same fact as `sealed_at`, which is when authoring closed — a Family that '
  'finishes early seals in December and still starts on 1 January. A Year opened inside '
  'its own calendar year has this in the past, and play opens the moment it seals.';

-- ---------------------------------------------------------------------------------
-- The three places that read `sealed_at` and meant "the Year is under way"
-- ---------------------------------------------------------------------------------

-- §11.5, with the second half of the sentence now enforceable. An Increment needs a
-- sealed Board AND a Year that has started; before slice 22 the first implied the
-- second.
--
-- This is an RLS predicate, so a tap that fails it comes back as `42501` from the
-- policy rather than as a message. That is why the client is given `play_opens_at` and
-- refuses the tap itself (§0.3 — never offer a control that cannot work): this is the
-- backstop, not the explanation.
create or replace function tile_is_loggable(target_tile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tiles t
      join boards b on b.id = t.board_id
      join years  y on y.id = b.year_id
     where t.id = target_tile_id
       and b.sealed_at is not null
       and now() >= y.play_opens_at
       and y.frozen_at is null
       and t.goal_id is not null
  );
$$;

comment on function tile_is_loggable(uuid) is
  'PRD §11.5 and §12.1: a Tile can take an Increment only while its Board is sealed, its '
  'Year has begun and is unfrozen, and it holds a personal Goal to make progress toward. '
  'An empty Tile and the shared Center Tile both fail the last condition, for different '
  'reasons — see migration 18. The play_opens_at clause is slice 22: a Board can now seal '
  'before the Year it belongs to starts.';

-- The floor under `occurred_at` moves with it. "No backdating" (§11.5) has always meant
-- "not before this Board could be played", and on an early-sealed Board that is the day
-- the Year opens rather than the day the Board sealed — otherwise a client whose clock
-- is fine could log 27 December against a Year that starts on the 1st and have it stand.
--
-- Still bounded above by `now()` for the reason migration 18 gives: a guard that sits in
-- the future refuses every honest tap, and `classifyDelivery` drops a `PT403` forever.
create or replace function stamp_increment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  playable_from timestamptz;
begin
  -- When the row landed, and never the client's to say. The Feed is ordered by this
  -- column (schema.md §9), so a client that could set it could pin itself to the top of
  -- its Family's Feed permanently.
  new.created_at := now();

  select greatest(b.sealed_at, y.play_opens_at) into playable_from
    from tiles t
    join boards b on b.id = t.board_id
    join years  y on y.id = b.year_id
   where t.id = new.tile_id;

  -- A NULL is only reachable by passing one explicitly, since the column default has
  -- already run by the time this fires.
  new.occurred_at := coalesce(new.occurred_at, now());

  -- A clock running fast. Kept, pulled back to now().
  if new.occurred_at > now() then
    new.occurred_at := now();
  end if;

  -- Before the Board could be played. Refused.
  --
  -- `greatest()` and `least()` **ignore** NULLs rather than propagating them — they answer
  -- NULL only when every argument is — and since `play_opens_at` is NOT NULL that makes
  -- `playable_from` a real instant even on an unsealed Board, where it is the start of the
  -- Year. So there is no NULL branch here to reason about, and the floor on an unsealed
  -- Board is the Year rather than nothing at all. Both are moot through RLS:
  -- `tile_is_loggable()` has already refused a Tile whose Board has not sealed.
  --
  -- `least(…, now())` is migration 18's half and still earns its place: a Board somehow
  -- stamped ahead of the clock must not refuse every honest tap, because `classifyDelivery`
  -- drops a `PT403` and the queue would destroy them.
  if new.occurred_at < least(playable_from, now()) then
    raise exception 'an Increment cannot predate the seal — there is no backdating (§11.5)'
      using errcode = 'PT403';
  end if;

  return new;
end;
$$;

-- The Family Goal is the one kind of progress with no Increment behind it — §12.3 marks
-- it done by a tap, with no Target to reach — so it is the one that has to say this
-- itself. `complete_family_goal()` already refused before the seal for exactly this
-- reason; the seal has simply stopped being the last of the two gates.
--
-- `PT425` rather than another `PT403`. The Boards ARE sealed, the caller IS a Member,
-- and the Family Goal DOES exist: the only thing wrong is the date, and it fixes itself.
-- Reusing the code that already covers "not sealed" and "no Family Goal" here is how
-- `writeGoalFailureCopy`'s centre branch became unreachable (HANDOFF, open item 8).
create or replace function complete_family_goal(year_id uuid, member_id uuid)
returns family_goals
language plpgsql
security definer
set search_path = public
as $$
declare
  yr years;
  fg family_goals;
begin
  select * into yr from years y where y.id = complete_family_goal.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  if complete_family_goal.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Member' using errcode = '42501';
  end if;

  -- Nothing crosses a Family boundary (ADR-0004). Checked against the Year's Family
  -- rather than the caller's, because an Account may be a Member of several.
  if family_of_member(complete_family_goal.member_id) is distinct from yr.family_id then
    raise exception 'that Member is not in this Family' using errcode = '42501';
  end if;

  -- Not before the Boards seal. resolve_center_vote() is callable by the Organizer on
  -- its own (api.md §2.1) and stamps family_goal_id onto every Tile 12, so between that
  -- call and the seal sweep there is a window where a Family Goal exists on Boards that
  -- are still drafts.
  if yr.sealed_at is null then
    raise exception 'this Year has not been sealed yet' using errcode = 'PT403';
  end if;

  -- And not before the Year starts. A Family that seals in December has a Family Goal on
  -- every Board, and completing it would fire a Milestone to every phone for a Year that
  -- has not begun (§15.1) — and complete a Tile on four of twelve Lines while it was at
  -- it (§13.1).
  if now() < yr.play_opens_at then
    raise exception 'this Year has not begun yet' using errcode = 'PT425';
  end if;

  -- A frozen Year is permanent family history (§20.1). Progress can no longer be
  -- recorded in it, and this is progress.
  if yr.frozen_at is not null then
    raise exception 'this Year is frozen' using errcode = '42501';
  end if;

  select * into fg from family_goals f where f.year_id = yr.id;
  if fg.id is null then
    raise exception 'this Year has no Family Goal' using errcode = 'PT403';
  end if;

  -- Idempotent (§12.3 has no undo). Two Members tapping "done" within a second of each
  -- other must not double the Feed, and must not move the timestamp the first one set —
  -- so the winner is whoever got there first, and the second caller is simply told the
  -- current state rather than an error they cannot act on.
  if fg.completed_at is not null then
    return fg;
  end if;

  update family_goals f
     set completed_at           = now(),
         completed_by_member_id = complete_family_goal.member_id
   where f.id = fg.id
  returning * into fg;

  -- One Milestone each, on each Member's own Tile 12 — a Milestone belongs to the Member
  -- whose Board it fell on, which is what lets the Feed and Wrapped count it per person.
  --
  -- Matched on `family_goal_id` rather than position alone, so a Board that never
  -- received the Family Goal is skipped rather than credited with a centre it does not
  -- carry. That is also the §21.2 hole: a Member approved in July gets a Board whose
  -- Tile 12 was never stamped, so they are skipped here too — see migration 19 and 38.
  perform record_tile_completion(b.member_id, yr.id, t.id)
     from tiles t
     join boards b on b.id = t.board_id
    where b.year_id = yr.id
      and t.position = 12
      and t.family_goal_id = fg.id;

  return fg;
end;
$$;

-- §9.5's free write of a personal Centre, measured from the later of the two instants
-- for the same reason as everything above.
--
-- Seven days from a 20 December seal ends on the 27th — before the Year it belongs to
-- has started, and over Christmas. The window's whole justification (migration 17) is
-- that a Member "learns the mode the moment their Board seals" and gets a week to act on
-- it; a week that expires before play opens is not that week. §18.5's half of the trade
-- is untouched: the window still closes seven days into the Year, so nobody can wait
-- until November and write a target-1 Goal into the square that sits on four Lines.
create or replace function center_write_deadline(board boards)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(board.sealed_at, y.play_opens_at) + interval '7 days'
    from years y where y.id = board.year_id
$$;

comment on function center_write_deadline(boards) is
  'PRD §9.5 with §18.5: how long the free write of a personal Center Tile stays open. '
  'Seven days from the later of the seal and the start of the Year — the Tile whose '
  'Setup Window was empty by construction gets one of its own, and after it the centre '
  'costs a Swap like any other empty Tile.';

revoke execute on function stamp_play_opens_at() from public, anon, authenticated;

-- `year_starts_at` inherits `setup_deadline_for`'s audience rather than choosing its own,
-- and that audience is **PUBLIC**, not `authenticated`.
--
-- `setup_deadline_for` was never revoked from PUBLIC — migration 12 only adds an
-- `authenticated` grant on top of the default — and `create or replace` above preserved
-- that ACL. It is plain SQL rather than SECURITY DEFINER, so it executes as its caller and
-- now calls this function: revoking from `anon` and `service_role` here does not tighten
-- anything, it breaks `setup_deadline_for` for those roles with `permission denied for
-- function year_starts_at`. That was the first version of this line, and it is the same
-- shape as the bug it was written to avoid.
--
-- Nothing is exposed by leaving it: it is a pure function of a year number and a timezone
-- name, both of which the caller supplied, and `startOfYearInZone()` in
-- src/domain/setup-window.ts computes the same answer client-side with no round trip.
grant execute on function year_starts_at(int, text) to public;

-- Read only by write_goal(), which is SECURITY DEFINER and reaches it regardless.
revoke execute on function center_write_deadline(boards) from public, anon, authenticated;
