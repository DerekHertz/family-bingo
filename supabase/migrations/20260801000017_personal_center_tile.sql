-- Slice 9, §9.5 — the personal Center Tile, which until now could never be authored.
--
-- "If mode resolved to personal, each Member authors Tile 12 themselves like any other
-- Tile" (PRD §9.5). That was unreachable. write_goal() opens position 12 only once
-- `center_mode = 'personal'`, and center_mode leaves 'undecided' inside
-- resolve_center_vote(), which seal_year() calls in the same transaction that stamps
-- `boards.sealed_at`. The window between the two guards is zero. Every personal-mode
-- Family got a permanently empty centre, and filling it cost one of three Swaps —
-- charged for a vote the Member did not control.
--
-- The fix is not to let Members author the centre during the Setup Window. Three
-- documents rule that out: Ballots are "movable until seal" (FRONTEND §4.3), a Member
-- "writes 24 Goals; the 25th square is the Centre" (FRONTEND §4.2, and CONTEXT.md's
-- Board), and §6.5 keeps position 12 out of authoring entirely. The mode genuinely
-- cannot be known before the Board seals.
--
-- So the personal centre gets one free write after sealing, and seven days to spend it
-- in — the same length §21.1 gives a late joiner, and for the same reason: somebody
-- arrived at an authoring window that had already shut. Note that this is NOT a Setup
-- Window in the CONTEXT.md sense; that term names the stretch before Sealing and ends
-- at it, and reusing it for a window that STARTS at the seal would make the glossary
-- mean two opposite things. It is a free write with a deadline, nothing more. Once
-- taken, or once the seven days are up, the centre is a sealed Tile like any other and
-- changing it costs a Swap.
--
-- The window is what reconciles this with §18.5, and it is not ceremony. Tile 12 sits on
-- row 2, column 2 AND both diagonals — four of the twelve Lines. Free and unbounded, a
-- Member could wait until November, look at which Lines they were one Tile short of,
-- and write a target-1 Goal into the centre to close one. That is the manufactured
-- Bingo the Swap budget exists to prevent (§18.5), and it is precisely the trade §18.5
-- names: "filling an empty Tile on an unfinished sealed Board also costs a Swap".
--
-- Seven days from the seal costs an engaged Member nothing — they learn the mode the
-- moment their Board seals — while charging nobody a Swap for the outcome of a vote
-- they did not control. Derived from `boards.sealed_at` rather than stored in a column
-- of its own: there is exactly one instant it could be measured from, and a second copy
-- of it would only be a chance to disagree. A late joiner sealed on their own clock
-- (§21.1) gets their seven days from their own seal, with no special case.
create or replace function center_write_deadline(board boards)
returns timestamptz
language sql
immutable
as $$ select board.sealed_at + interval '7 days' $$;

comment on function center_write_deadline(boards) is
  'PRD §9.5 with §18.5: how long the free write of a personal Center Tile stays open. '
  'Seven days from the seal — the Tile whose Setup Window was empty by construction '
  'gets one of its own, and after it the centre costs a Swap like any other empty Tile.';

create or replace function write_goal(
  tile_id        uuid,
  goal_text      text,
  target         int,
  unit           text default null,
  unit_canonical text default null,
  category       text default null,
  pace_hint      text default null
)
returns goals
language plpgsql
security definer
set search_path = public
as $$
declare
  tile   tiles;
  board  boards;
  yr     years;
  trimmed text := btrim(goal_text);
  written goals;
  -- The §9.5 write: an empty personal centre on a sealed Board. Named rather than
  -- inlined into the guard below, because what it is matters more than what it excludes.
  claiming_personal_center boolean;
begin
  select * into tile from tiles t where t.id = write_goal.tile_id;
  if tile.id is null then
    raise exception 'no such Tile' using errcode = '42501';
  end if;

  select * into board from boards b where b.id = tile.board_id;
  select * into yr    from years  y where y.id = board.year_id;

  -- Writes are self-only. A Guardian authoring for a Managed Member is the normal case
  -- (§4.2), which is why this checks the Member rather than the Account.
  if board.member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Board' using errcode = '42501';
  end if;

  if yr.frozen_at is not null then
    raise exception 'this Year is frozen' using errcode = '42501';
  end if;

  -- Still empty, still personal, and still inside the seven days. Past the deadline it
  -- stops being the §9.5 write and becomes an ordinary empty Tile on a sealed Board, so
  -- it falls through to the guard below and is told it costs a Swap — which by then is
  -- exactly what it is (§18.5).
  claiming_personal_center :=
    tile.position = 12
    and yr.center_mode = 'personal'
    and tile.goal_id is null
    and now() <= center_write_deadline(board);

  -- Everything before Sealing is free editing; everything after costs a Swap
  -- (CONTEXT.md, Sealing). swap_tile() is slice 18 and is the only other way in.
  if board.sealed_at is not null and not claiming_personal_center then
    raise exception 'this Board is sealed — changing a Goal now costs a Swap'
      using errcode = 'PT403';
  end if;

  -- §6.5: the Center Tile is not authored like the others. It becomes writable only
  -- once the Center Vote has resolved to 'personal', in which case each Member fills it
  -- themselves like any other Tile (§9.5). While the mode is 'undecided' or 'shared' it
  -- belongs to the Family, not to the Member.
  if tile.position = 12 and yr.center_mode <> 'personal' then
    raise exception 'the Center Tile is decided by the Family, not authored'
      using errcode = 'PT403';
  end if;

  if char_length(coalesce(trimmed, '')) not between 1 and 200 then
    raise exception 'a Goal must be 1 to 200 characters' using errcode = '22023';
  end if;

  -- target = 1 IS the one-shot shape. There is no goal_type enum and no second code
  -- path (§6.2, ADR-0002), so this is the only shape check there is.
  if target is null or target < 1 then
    raise exception 'a Target must be at least 1' using errcode = '22023';
  end if;

  if char_length(coalesce(unit, '')) > 30 then
    raise exception 'a unit must be 30 characters or fewer' using errcode = '22023';
  end if;

  if tile.goal_id is not null then
    -- Free editing on a draft Board (§6.4). Updating in place rather than inserting a
    -- replacement keeps the Tile pointing at one Goal throughout, so nothing is ever
    -- orphaned mid-transaction.
    update goals g
       set text           = trimmed,
           target         = write_goal.target,
           unit           = nullif(btrim(write_goal.unit), ''),
           unit_canonical = nullif(btrim(lower(write_goal.unit_canonical)), ''),
           category       = write_goal.category,
           pace_hint      = nullif(btrim(write_goal.pace_hint), '')
     where g.id = tile.goal_id
    returning * into written;
  else
    insert into goals (text, target, unit, unit_canonical, category, pace_hint)
    values (trimmed, write_goal.target,
            nullif(btrim(write_goal.unit), ''),
            nullif(btrim(lower(write_goal.unit_canonical)), ''),
            write_goal.category,
            nullif(btrim(write_goal.pace_hint), ''))
    returning * into written;

    update tiles set goal_id = written.id where id = tile.id;
  end if;

  return written;
end;
$$;

-- No client ever calls this directly — it exists to be read by write_goal(), which is
-- SECURITY DEFINER and so reaches it regardless. write_goal() itself needs no re-grant:
-- CREATE OR REPLACE preserves the privileges migration 13 already set on it, and
-- re-granting here would only create a second place for them to drift.
revoke execute on function center_write_deadline(boards) from public, anon, authenticated;
