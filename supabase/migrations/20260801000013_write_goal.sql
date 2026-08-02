-- Slice 6, server half — a Member writes a Goal onto a Tile.
--
-- Authoring is an RPC rather than two client writes for the reason given in the RLS
-- migration: a Goal is reachable only through the Tile that holds it, so an unattached
-- `goals` row is readable by nobody — including the person who just inserted it. Insert
-- and link have to happen together or the client cannot even read back what it wrote.
--
-- §6.1a is the requirement most likely to be misread here. `unit_canonical` and
-- `category` are NEVER typed by a Member and never appear as a form field; they are
-- inferred during Sharpening (§7.10) and exist so Wrapped can aggregate across Members.
-- A Goal that skipped Sharpening leaves both NULL and still counts everywhere except
-- aggregate Wrapped cards (§20.8). This function accepts them, but only because the
-- client passes back what the sharpen Edge Function returned.

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

  -- Everything before Sealing is free editing; everything after costs a Swap
  -- (CONTEXT.md, Sealing). swap_tile() is slice 18 and is the only way in after this.
  if board.sealed_at is not null then
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

-- Clear a Tile while the Board is still a draft. Tiles may be filled in any order and
-- edited freely until Sealing (§6.4), and an unfinished Board seals with empty Tiles
-- (§10.2) — so emptying one is a legitimate thing to do right up to the deadline.
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
end;
$$;

revoke execute on function write_goal(uuid, text, int, text, text, text, text) from public, anon;
revoke execute on function clear_goal(uuid) from public, anon;
grant execute on function write_goal(uuid, text, int, text, text, text, text) to authenticated;
grant execute on function clear_goal(uuid) to authenticated;
