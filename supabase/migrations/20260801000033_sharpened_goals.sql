-- Slice 7, the half that makes "one sharpen per Goal" true.
--
-- FRONTEND_DESIGN §4.2: "One sharpen per Goal, spent only on a successful response...
-- This is a product rule, not a cost control: a rerollable sharpener turns writing a goal
-- into a slot machine."
--
-- The client first enforced that by inferring it: a Goal with a `category` had been
-- through Sharpening, because only Sharpening writes one. The inference is wrong twice.
-- Tapping "Sharpen it" saves the Member's own words first (§7.9, never lose input) and
-- that write carries no category, so backing out of the two cards and reopening the Tile
-- offered a fresh sharpen — one navigation per reroll, which is the slot machine. And
-- `normalizeSuggestions` nulls a category the model returns outside the seven-member
-- enum, so a perfectly successful sharpen could leave the Goal rerollable forever.
--
-- A rule enforced by inference is not a rule. This is the fact it needed.

alter table goals add column sharpened_at timestamptz;

comment on column goals.sharpened_at is
  'When Sharpening last produced this Goal (PRD §7, FRONTEND_DESIGN §4.2). Set once and '
  'never cleared: it records that the Goal''s one sharpen has been spent, which is why '
  'it survives the Member editing the text by hand afterwards. NOT a spend counter — '
  '§7.8''s 100-per-Member-per-Year limit lives in sharpen_usage and is a different rule.';

-- Same signature plus `sharpened`, so it has to be dropped rather than replaced:
-- CREATE OR REPLACE cannot change a function's argument list, and creating it with an
-- extra defaulted parameter would leave TWO overloads behind. PostgREST resolves an RPC
-- by argument name and would then have to pick between them.
drop function if exists write_goal(uuid, text, int, text, text, text, text);

create or replace function write_goal(
  tile_id        uuid,
  goal_text      text,
  target         int,
  unit           text default null,
  unit_canonical text default null,
  category       text default null,
  pace_hint      text default null,
  sharpened      boolean default false
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
    --
    -- `sharpened_at` uses coalesce in the opposite direction to every other column here:
    -- the EXISTING value wins. A sharpen is spent once, and the Member editing their
    -- Goal by hand afterwards — which §4.2 explicitly invites — must not hand it back.
    update goals g
       set text           = trimmed,
           target         = write_goal.target,
           unit           = nullif(btrim(write_goal.unit), ''),
           unit_canonical = nullif(btrim(lower(write_goal.unit_canonical)), ''),
           category       = write_goal.category,
           pace_hint      = nullif(btrim(write_goal.pace_hint), ''),
           sharpened_at   = coalesce(g.sharpened_at,
                                     case when write_goal.sharpened then now() end)
     where g.id = tile.goal_id
    returning * into written;
  else
    insert into goals (text, target, unit, unit_canonical, category, pace_hint, sharpened_at)
    values (trimmed, write_goal.target,
            nullif(btrim(write_goal.unit), ''),
            nullif(btrim(lower(write_goal.unit_canonical)), ''),
            write_goal.category,
            nullif(btrim(write_goal.pace_hint), ''),
            case when write_goal.sharpened then now() end)
    returning * into written;

    update tiles set goal_id = written.id where id = tile.id;
  end if;

  return written;
end;
$$;

-- The DROP above took the old grants with it.
revoke execute on function
  write_goal(uuid, text, int, text, text, text, text, boolean) from public, anon;
grant execute on function
  write_goal(uuid, text, int, text, text, text, text, boolean) to authenticated;
