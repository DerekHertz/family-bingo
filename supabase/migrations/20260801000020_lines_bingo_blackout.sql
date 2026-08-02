-- Slice 13, server half — Lines, Bingo and Blackout.
--
-- Acceptance test (PRD §13):
--   Given a Board with Tiles 0, 1, 2, 3 complete
--   When Tile 4 completes
--   Then a Line is recorded for row 0, a `bingo` Milestone fires (it is the Member's
--   first Line), and the Board shows 1 of 12 Lines
--
-- Slice 12 recorded the moment a Tile crosses its Target. This slice records what that
-- crossing closed. No new state: a Line is a pure function of the completed positions
-- (§13.6, schema.md §3.1), and Bingo/Blackout are the presence of a Milestone row, not
-- a flag on the Board.
--
-- The logic already exists and is unit-tested — completedLines(), isBlackout() and the
-- Line half of milestonesToEmit() in src/domain. What follows is that same function
-- transcribed, so the two must agree; the pgTAP suite checks the transcription against
-- cases the Vitest suite covers exhaustively.
--
-- §13.5 is a requirement about what is NOT here: no leaderboard, no ordering of Members,
-- no "first to Bingo". Nothing in this file compares one Member to another, and the only
-- cross-Member read is the shared Family Goal, which advances everybody identically.

-- ---------------------------------------------------------------------------------
-- §13.1 — the twelve Lines, enumerated
-- ---------------------------------------------------------------------------------
--
-- Constants, not computed from the row-major indexing. The order is part of the
-- contract: `milestones.line_index` refers to it and the 12-segment pip row beneath the
-- Board renders in it, so it must match src/domain/lines.ts LINES exactly — rows 0–4,
-- columns 5–9, ↘ 10, ↙ 11.
--
-- The Center Tile sits on 4 of them (row 2, column 2, both diagonals), which is why
-- completing a shared Family Goal advances every Member on four Lines at once.
create or replace function board_lines()
returns table (line_index int, positions int[])
language sql
immutable
as $$
  values
    ( 0::int, array[ 0,  1,  2,  3,  4]::int[]),
    ( 1,      array[ 5,  6,  7,  8,  9]),
    ( 2,      array[10, 11, 12, 13, 14]),
    ( 3,      array[15, 16, 17, 18, 19]),
    ( 4,      array[20, 21, 22, 23, 24]),
    ( 5,      array[ 0,  5, 10, 15, 20]),
    ( 6,      array[ 1,  6, 11, 16, 21]),
    ( 7,      array[ 2,  7, 12, 17, 22]),
    ( 8,      array[ 3,  8, 13, 18, 23]),
    ( 9,      array[ 4,  9, 14, 19, 24]),
    (10,      array[ 0,  6, 12, 18, 24]),
    (11,      array[ 4,  8, 12, 16, 20]);
$$;

comment on function board_lines() is
  'PRD §13.1. The twelve Lines as constants, in the order milestones.line_index refers '
  'to. Must match LINES in src/domain/lines.ts — the client renders the pip row from '
  'that copy and the database records against this one.';

-- ---------------------------------------------------------------------------------
-- Which Tiles are complete, right now
-- ---------------------------------------------------------------------------------
--
-- The SQL half of completedPositions(). Both ways a Tile can be complete, and only those
-- two: a Family Goal that has been marked done (§12.3), or Increments that have reached
-- a Target (§12.1). `tile_goal_source_exclusive` makes them mutually exclusive, so the
-- OR cannot double-count.
--
-- Derived on every call, never stored (schema.md §3.1). Note that this reads the live
-- log, not the recorded `tile_completed` Milestones — the two diverge when a Member
-- deletes an Increment, which §11.3 permits as the way to correct a mistake. The
-- Milestone stands because it was pushed to phones and cannot be unsent; the Tile itself
-- reads incomplete again, and so does any Line through it. A Bingo has to be checkable
-- against the Board as it actually stands (CONTEXT.md, Revision), not against a claim
-- that has since been withdrawn.
create or replace function board_completed_positions(target_board_id uuid)
returns int[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t.position order by t.position), array[]::int[])
    from tiles t
    left join goals        g on g.id = t.goal_id
    left join family_goals f on f.id = t.family_goal_id
   where t.board_id = target_board_id
     and (
       -- Marked, not counted: a Family Goal has no Target to reach (§12.3).
       f.completed_at is not null
       -- §12.1. An empty Tile on a Board that sealed unfinished has no Goal, hence no
       -- Target, and can never be complete (§10.2) — the NULL is checked rather than
       -- compared, because `count >= NULL` is NULL and would silently pass nothing.
       or (g.target is not null
           and (select count(*) from increments i where i.tile_id = t.id) >= g.target)
     )
$$;

-- ---------------------------------------------------------------------------------
-- §13.2, §13.3 — recording what a completion closed
-- ---------------------------------------------------------------------------------
--
-- The SQL half of the Line and Blackout arms of milestonesToEmit(): diff the Board's
-- live state against what `milestones` already holds, and record the difference. A diff
-- rather than a reaction to the write is what makes it idempotent — a replayed offline
-- queue (§17.4) re-derives the same state and emits nothing the second time.
create or replace function record_line_milestones(target_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  done         int[];
  board_owner  uuid;
  board_year   uuid;
  bingo_earned boolean;
  ln           record;
  recorded     int;
begin
  select b.member_id, b.year_id into board_owner, board_year
    from boards b where b.id = target_board_id;

  if board_owner is null then
    return;
  end if;

  done := board_completed_positions(target_board_id);

  -- §13.2: the FIRST Line a Member ever closes is their Bingo, every later one is the
  -- quieter line_completed. Any recorded Line means the Bingo has already been spent —
  -- checked against both types rather than against 'bingo' alone so that this agrees
  -- with milestonesToEmit(), which reads the same set.
  select exists (
    select 1 from milestones m
     where m.member_id = board_owner
       and m.year_id   = board_year
       and m.type in ('bingo', 'line_completed')
  ) into bingo_earned;

  -- In constant order, so that when several Lines close at the same moment — the shared
  -- Family Goal closes up to four — exactly one of them is the Bingo and it is always
  -- the same one.
  for ln in select l.line_index, l.positions from board_lines() l order by l.line_index
  loop
    continue when not (ln.positions <@ done);

    continue when exists (
      select 1 from milestones m
       where m.member_id  = board_owner
         and m.year_id    = board_year
         and m.line_index = ln.line_index
         and m.type in ('bingo', 'line_completed')
    );

    -- §13.4: play continues after Bingo to the end of the Year, so every later Line
    -- still earns a Milestone. Bingo is a rung on a ladder, not an ending.
    insert into milestones (member_id, year_id, type, line_index)
    values (board_owner, board_year,
            case when bingo_earned then 'line_completed' else 'bingo' end,
            ln.line_index)
        on conflict do nothing;

    get diagnostics recorded = row_count;

    -- A Bingo that lost a race is still a Line, and must not vanish.
    --
    -- `bingo_earned` was read once, at the top. Two transactions closing two different
    -- Lines for the same Member at the same moment — a live tap while the offline queue
    -- replays (§17.4) — both read false and both aim for 'bingo'. The loser is rejected
    -- by one_bingo_per_year, and DO NOTHING would swallow it: that Line ends up with no
    -- Milestone of either kind, and the Board reads n-1 of 12. It self-heals on the next
    -- completion, because this whole function is a diff — but if it was the Year's last
    -- completion there is no next one, and the Line is lost for good.
    --
    -- So a rejected Bingo is retried as the thing it actually is. The retry can conflict
    -- in turn, on one_milestone_per_line, if the racing transaction was closing this same
    -- Line rather than another; that one is a genuine duplicate and DO NOTHING is right.
    if recorded = 0 and not bingo_earned then
      insert into milestones (member_id, year_id, type, line_index)
      values (board_owner, board_year, 'line_completed', ln.line_index)
          on conflict do nothing;
    end if;

    bingo_earned := true;
  end loop;

  -- §13.3. A Board has exactly 25 Tiles, dealt by open_year() and held there by
  -- one_tile_per_position, so 25 distinct complete positions is every Tile.
  if cardinality(done) = 25 then
    insert into milestones (member_id, year_id, type)
    values (board_owner, board_year, 'blackout')
        on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------
-- When to look
-- ---------------------------------------------------------------------------------
--
-- A Line can only close when a Tile completes, so completion is the trigger. Hanging it
-- off the `tile_completed` Milestone catches both ways that happens — Increments
-- reaching a Target, and complete_family_goal() marking Tile 12 for every Member — with
-- no change to either, and it fixes the Feed's ordering for free: the Tile Milestone is
-- committed before the Lines it closed are even looked for, so a Line never appears
-- above the completion that caused it.
--
-- WHEN (new.type = 'tile_completed') is also what stops the recursion: the bingo,
-- line_completed and blackout rows written above do not re-enter this.
create or replace function emit_line_milestones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform record_line_milestones(t.board_id) from tiles t where t.id = new.tile_id;
  return null;
end;
$$;

create trigger milestones_emit_lines
  after insert on milestones
  for each row when (new.type = 'tile_completed')
  execute function emit_line_milestones();

-- ---------------------------------------------------------------------------------
-- The crossing that records no Milestone
-- ---------------------------------------------------------------------------------
--
-- Slice 12's trigger, with one branch added. Unchanged: the Board's owner rather than
-- new.member_id, the NULL-Target guard, the count taken fresh, AFTER INSERT only.
--
-- What is new is the tail. record_tile_completion() is deliberately a no-op when the Tile
-- already has its Milestone, and a Tile can be complete, lose an Increment to §11.3, and
-- complete again — at which point nothing is inserted and the trigger above never fires.
-- Without this a Member who corrects a mistake on Tile 0 while Tiles 1–4 close would
-- never be told about row 0.
--
-- Gated on whether the Milestone was already there, so the two paths partition rather
-- than overlap: a first crossing is news, and the trigger on `milestones` handles it;
-- anything else lands here. The gate matters because "anything else" includes every tap
-- past a Target, and a Board scan is 25 correlated counts — a Goal of 150 walks would
-- otherwise pay for one on each of the 149 taps after the hundred-and-first.
create or replace function emit_tile_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_count     int;
  board_year       uuid;
  board_owner      uuid;
  owning_board     uuid;
  already_recorded boolean;
begin
  -- The Board's owner, not `new.member_id`. RLS forces the two equal for any client —
  -- increments_own_insert requires the Tile to belong to the Board of the Member being
  -- credited — but this function is SECURITY DEFINER and a privileged path does not pass
  -- through that policy. Attributing to the logger there would misfile the Milestone and,
  -- because one_tile_completed_per_tile is keyed on (member_id, tile_id), would let a
  -- second row exist for the same Tile — the one thing §12.2 forbids.
  select g.target, b.year_id, b.member_id, b.id
    into target_count, board_year, board_owner, owning_board
    from tiles t
    join boards b on b.id = t.board_id
    join goals  g on g.id = t.goal_id
   where t.id = new.tile_id;

  -- No Goal on the Tile means no Target to cross. tile_is_loggable() already refuses
  -- that Increment through RLS (§12.1), so this is unreachable from a client and is
  -- here only so that a privileged path cannot trip over a NULL comparison.
  if target_count is null then
    return null;
  end if;

  -- §12.1. The count is taken fresh rather than tracked, and this AFTER trigger sees
  -- the new row already included.
  if (select count(*) from increments i where i.tile_id = new.tile_id) < target_count then
    return null;
  end if;

  -- §12.2: exactly one, ever. Logging past the Target does not fire a second — overshoot
  -- is celebrated once, in Wrapped (§20.4), never as another interruption. Nor does
  -- re-crossing after an Increment was deleted: the recorded row is what stops the
  -- second notification, exactly as milestonesToEmit() treats it.
  -- Read before the write, because after it the row exists either way.
  already_recorded := exists (
    select 1 from milestones m
     where m.member_id = board_owner
       and m.tile_id   = new.tile_id
       and m.type      = 'tile_completed'
  );

  perform record_tile_completion(board_owner, board_year, new.tile_id);

  -- §13. A completion that recorded nothing still closed whatever it closed.
  if already_recorded then
    perform record_line_milestones(owning_board);
  end if;

  return null;
end;
$$;

-- No client calls any of these. Milestones have no INSERT grant to `authenticated` at
-- all and this is why: a Bingo is a social claim, and the only writer is the database
-- reacting to a log it can verify (§13, and the milestones read policy).
revoke execute on function board_lines() from public, anon, authenticated;
revoke execute on function board_completed_positions(uuid) from public, anon, authenticated;
revoke execute on function record_line_milestones(uuid) from public, anon, authenticated;
revoke execute on function emit_line_milestones() from public, anon, authenticated;
