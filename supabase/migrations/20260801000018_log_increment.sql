-- Slice 11, server half — Logging an Increment.
--
-- Acceptance test (PRD §11):
--   Given a sealed Board with a Goal of target 144
--   When the Member taps the Tile once
--   Then an Increment exists and progress reads 1/144
--
-- There is no log_increment() RPC here, and there must not be one. The client upserts
-- the row directly on the UUID it generated (api.md §8), because that upsert IS the
-- offline queue's entire conflict story (§11.2, §17.4) — an RPC would put a function
-- signature between the queue and the table and buy nothing. Progress is COUNT(*) and
-- is never denormalized (§11.4), so there is no counter to maintain either.
--
-- What that leaves is the two rules the RLS baseline stated in comments and never
-- actually enforced.

-- ---------------------------------------------------------------------------------
-- An Increment is progress toward a Goal, so a Tile holding none cannot take one
-- ---------------------------------------------------------------------------------
--
-- Two kinds of Tile hold no personal Goal, and neither can count Increments:
--
--   * An empty Tile. Boards seal whether or not authoring finished (§10.2), so empty
--     Tiles are ordinary rather than exceptional — and progress toward nothing has no
--     Target to be measured against. `COUNT(increments) >= target` (§12.1) is not a
--     question with an answer when there is no target.
--   * The shared Center Tile. A Family Goal has no Target at all: it is marked done by
--     any Member and completes for everyone at once (§12.3), which is why
--     `family_goals` carries `completed_at` and no counter.
--
-- The empty Tile is the one with teeth. §18.6 carries existing Increments over to a
-- swapped-in Goal, so without this a Member could tap an empty Tile ninety times in
-- November, spend a single Swap writing "ninety walks" onto it, and watch the Tile
-- complete on arrival. That is exactly the manufactured Bingo the Swap budget exists to
-- prevent (§18.5), having taken the scenic route around it.
--
-- Deletion is gated by the same function, which is right: an Increment can only exist
-- on a Tile that had a Goal when it was logged, and swap_tile() never clears one.
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
       and y.frozen_at is null
       and t.goal_id is not null
  );
$$;

comment on function tile_is_loggable(uuid) is
  'PRD §11.5 and §12.1: a Tile can take an Increment only while its Board is sealed and '
  'its Year unfrozen, and only if it holds a personal Goal to make progress toward. An '
  'empty Tile and the shared Center Tile both fail the last condition, for different '
  'reasons — see the migration comment.';

-- ---------------------------------------------------------------------------------
-- §11.5 — "no backdating", enforced against the timestamp and not merely the clock
-- ---------------------------------------------------------------------------------
--
-- `occurred_at` and `created_at` are two different facts, and only one of them is the
-- client's to state. `created_at` is when the row reached the database. `occurred_at`
-- is when the Member says they tapped. They come apart legitimately — the offline queue
-- holds taps across app restarts and replays them days later (§17.3), which is the
-- whole reason `occurred_at` is a column of its own rather than an alias.
--
-- The RLS policy enforces §11.5 against wall-clock arrival: the Board must be sealed
-- and the Year unfrozen at the instant of the INSERT. Nothing enforced it against the
-- timestamp the row actually claims, so a client was free to write occurred_at = March
-- while logging in December. That is not a small hole. Wrapped aggregates by month and
-- hands out "biggest month" and "most consistent" (§20.4, ADR-0006); an unbounded
-- occurred_at writes those Awards.
--
-- The two ends of the range are not symmetrical, and are not treated as such.
--
-- A FUTURE occurred_at is a device whose clock runs fast. It is benign, no honest
-- Member could act on being told, and refusing it would throw away a real tap over
-- something that is not their doing — while the offline queue, unable to tell a refusal
-- from a dropped connection, retries it forever. So it is pulled back to now() and the
-- tap is kept.
--
-- An occurred_at BEFORE the seal has no honest cause. No offline queue can hold a tap
-- from before the Board it belongs to existed, so this is either a client bug worth
-- surfacing or the backdating §11.5 names outright. It is refused.
create or replace function stamp_increment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  board_sealed_at timestamptz;
begin
  -- When the row landed, and never the client's to say. The Feed is ordered by this
  -- column (schema.md §9), so a client that could set it could pin itself to the top of
  -- its Family's Feed permanently.
  new.created_at := now();

  select b.sealed_at into board_sealed_at
    from tiles t join boards b on b.id = t.board_id
   where t.id = new.tile_id;

  -- A NULL is only reachable by passing one explicitly, since the column default has
  -- already run by the time this fires.
  new.occurred_at := coalesce(new.occurred_at, now());

  -- A clock running fast. Kept, pulled back to now().
  if new.occurred_at > now() then
    new.occurred_at := now();
  end if;

  -- Before the Board existed. Refused.
  --
  -- The bound is least(sealed_at, now()) rather than sealed_at, so that it can never sit
  -- in the future and refuse every possible tap. A Board stamped ahead of the clock is
  -- not a state seal_year() can produce — it always stamps now() — but tile_is_loggable()
  -- asks only whether `sealed_at is not null`, so nothing upstream rules it out, and a
  -- guard that answers "no" to every honest Increment is worse than the hole it closes.
  --
  -- NULL is left alone deliberately: a Tile with no sealed Board has already been refused
  -- by tile_is_loggable() through RLS, and a second, differently-worded error for the
  -- same cause would only mislead whoever reads it.
  if new.occurred_at < least(board_sealed_at, now()) then
    raise exception 'an Increment cannot predate the seal — there is no backdating (§11.5)'
      using errcode = 'PT403';
  end if;

  return new;
end;
$$;

-- BEFORE INSERT only. There is no UPDATE grant on `increments` and no update policy —
-- the log is append-only (§11.3) — so an update trigger would guard a door with no
-- handle on it.
create trigger increments_stamp
  before insert on increments
  for each row execute function stamp_increment();

revoke execute on function stamp_increment() from public, anon, authenticated;
