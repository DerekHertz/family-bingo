-- Slice 18, server half — Swaps.
--
-- Acceptance test (PRD §18):
--   Given a Member with a sealed Board and 3 Swaps remaining
--   When they replace a Goal
--   Then a Revision records the before and after, the Feed shows the Swap to the Family,
--   and 2 Swaps remain
--   And when a Member with 0 Swaps remaining attempts one
--   Then it is rejected
--
-- The rules are already written and unit-tested exhaustively: costOfRewrite() and
-- evaluateGoalRewrite() in src/domain/swaps.ts. This is that decision procedure in SQL,
-- in the same order, plus the two things a pure function cannot do — write the Revision
-- and spend the budget.
--
-- §18.5 is why any of this exists. A Bingo notification is a social claim, and without a
-- budget anyone could lower a Target from 144 to 90 in November and manufacture one.
-- Scarcity plus visibility closes that without making the Board a prison.

create or replace function swap_tile(
  tile_id   uuid,
  goal_text text,
  target    int
)
returns goals
language plpgsql
security definer
set search_path = public
as $$
declare
  tile        tiles;
  board       boards;
  yr          years;
  before_goal goals;
  trimmed     text := btrim(goal_text);
  progress    int;
  costs_swap  boolean;
  written     goals;
begin
  select * into tile from tiles t where t.id = swap_tile.tile_id;
  if tile.id is null then
    raise exception 'no such Tile' using errcode = '42501';
  end if;

  select * into board from boards b where b.id = tile.board_id;
  select * into yr    from years  y where y.id = board.year_id;

  -- Self-only, like every write. A Guardian swapping for their Managed Member is the
  -- normal case (§4.2), which is why this checks the Member and not the Account.
  if board.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Board' using errcode = '42501';
  end if;

  -- A frozen Year refuses everything, first, before any of the rest is worth asking
  -- (§20.1). evaluateGoalRewrite() checks it first for the same reason.
  if yr.frozen_at is not null then
    raise exception 'this Year is frozen' using errcode = '42501';
  end if;

  -- A draft Board is not a commitment yet and nothing on it costs anything (§6.4). That
  -- is write_goal()'s door, not this one — one RPC per state, so neither has to explain
  -- the other's rules.
  if board.sealed_at is null then
    raise exception 'this Board is still a draft — edit it with write_goal'
      using errcode = 'PT403';
  end if;

  -- The shared Center Tile is one Family Goal row referenced by every Board (§9.4). It
  -- is not one Member's to rewrite, at any price.
  if tile.family_goal_id is not null then
    raise exception 'the Center Tile belongs to the Family, not to one Member'
      using errcode = 'PT403';
  end if;

  if char_length(coalesce(trimmed, '')) not between 1 and 200 then
    raise exception 'a Goal must be 1 to 200 characters' using errcode = '22023';
  end if;
  if target is null or target < 1 then
    raise exception 'a Target must be at least 1' using errcode = '22023';
  end if;

  select * into before_goal from goals g where g.id = tile.goal_id;
  select count(*) into progress from increments i where i.tile_id = tile.id;

  -- A completed Tile is finished. Rewriting it would rewrite a Milestone the Family has
  -- already been told about, and §12.2 pushed that to their phones.
  if before_goal.id is not null and progress >= before_goal.target then
    raise exception 'this Tile is already complete' using errcode = 'PT403';
  end if;

  -- costOfRewrite(), transcribed. An empty Tile on a Board that sealed unfinished costs a
  -- Swap to fill (§18.5, last sentence) — the Tile was empty by the Member's own choice,
  -- and filling it in December against a Line they are one short of is the same
  -- manufactured Bingo by another route.
  costs_swap := before_goal.id is null
                or btrim(before_goal.text) <> trimmed
                or target < before_goal.target;

  -- §18.3: raising a Target is free and is NOT a Swap, because making a Goal harder needs
  -- no policing. It writes no Revision either — a Revision is what spends the budget
  -- (revisions_bump_swaps_used), so recording one here would quietly charge for it.
  if costs_swap then
    -- §18.1, three per Member per Year. The CHECK on boards.swaps_used is the enforcement
    -- of last resort; this is the error the Member can actually read.
    if board.swaps_used >= 3 then
      raise exception 'no Swaps remaining this Year' using errcode = 'PT403';
    end if;

    insert into revisions (board_id, tile_id, before_text, before_target,
                           after_text, after_target)
    values (board.id, tile.id, before_goal.text, before_goal.target, trimmed, target);
  end if;

  -- §18.6: the Goal row is updated in place and no Increment is touched. Progress hangs
  -- off the Tile, not the Goal, so it carries over against the new Target by construction
  -- rather than by being copied.
  if before_goal.id is not null then
    update goals g
       set text = trimmed, target = swap_tile.target
     where g.id = before_goal.id
    returning * into written;
  else
    insert into goals (text, target) values (trimmed, swap_tile.target)
    returning * into written;
    update tiles set goal_id = written.id where id = tile.id;
  end if;

  -- A lowered Target can land below the progress already logged: 100 Increments against a
  -- Target moved from 144 to 90 completes the Tile the instant the Swap commits. Nothing
  -- else would notice. Completion Milestones are emitted by the Increment trigger (§12),
  -- and there is no Increment here — so a Member could close a Line, and a Bingo, in
  -- silence.
  --
  -- That is precisely the move §18.5 is about, and the answer is not to forbid it: they
  -- paid a Swap and the Family can see the Revision. The answer is that it must be as
  -- loud as any other completion.
  if progress >= written.target then
    perform record_tile_completion(board.member_id, board.year_id, tile.id);
    perform record_line_milestones(board.id);
  end if;

  return written;
end;
$$;

revoke execute on function swap_tile(uuid, text, int) from public, anon;
grant execute on function swap_tile(uuid, text, int) to authenticated;
