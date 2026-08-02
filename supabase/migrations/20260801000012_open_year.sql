-- Slice 5, server half — the Organizer opens a Year, and everyone gets a Board.
--
-- The timing here is the same rule as src/domain/setup-window.ts, expressed in SQL
-- because pg_cron will read it and no client is involved. If you change one, change both:
-- the TypeScript version is what the app shows a Member, and this is what actually seals
-- their Board.

-- When the Setup Window closes (PRD §5.2).
--
-- Normally midnight on 1 January in the Family's timezone. Opened later than seven days
-- before that, the deadline becomes now + 7 days instead — nobody gets less than a week
-- to author 24 Goals, including a Family that forms on December 30th.
create or replace function setup_deadline_for(calendar_year int, timezone text, opened_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select greatest(
    make_timestamp(calendar_year, 1, 1, 0, 0, 0) at time zone timezone,
    opened_at + interval '7 days'
  );
$$;

-- A Board and its 25 Tiles, idempotently (PRD §5.3).
--
-- Idempotent because it is called from two places that must not fight: open_year, over
-- every active Member at once, and — from slice 21 — the approval of a Member who joins
-- in July. Positions are row-major, 0-indexed, and position 12 is the Center Tile
-- (§5.4). The Center is left empty here; the Center Vote fills it (§6.5).
-- Parameters are named target_* rather than member_id/year_id because ON CONFLICT
-- resolves bare column names against plpgsql variables first, and would bind the
-- inference clause to the parameters instead of the index.
create or replace function ensure_board(target_member_id uuid, target_year_id uuid)
returns boards
language plpgsql
security definer
set search_path = public
as $$
declare
  board boards;
begin
  insert into boards (member_id, year_id)
  values (target_member_id, target_year_id)
  on conflict (member_id, year_id) do nothing;

  select * into board from boards b
   where b.member_id = target_member_id and b.year_id = target_year_id;

  insert into tiles (board_id, position)
  select board.id, p from generate_series(0, 24) p
  on conflict (board_id, position) do nothing;

  return board;
end;
$$;

-- Open a Year (§5.1).
--
-- Creates the Year, a Board with 25 Tiles for every ACTIVE Member, and both Votes. The
-- goal Vote is created even though it only runs if the mode Vote resolves to 'shared'
-- (§9.1) — one transaction, one shape, and resolve_vote can then assume it exists.
--
-- Pending Members get no Board. They can read nothing (§3.2), so a Board they cannot see
-- would only be a row waiting to confuse someone; they get one when they are approved.
create or replace function open_year(family_id uuid, calendar_year int)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  fam families;
  deadline timestamptz;
  created years;
  member_row members;
begin
  if not is_organizer_of(open_year.family_id) then
    raise exception 'only the Organizer may open a Year' using errcode = '42501';
  end if;

  select * into fam from families where id = open_year.family_id;

  -- "Year" means the calendar year in the Family's timezone (§8.3 T3), so the earliest
  -- Year that can be opened is decided there too, not in UTC.
  if open_year.calendar_year <
     extract(year from (now() at time zone fam.timezone))::int then
    raise exception 'that Year has already passed' using errcode = '22023';
  end if;

  if exists (
    select 1 from years y
     where y.family_id = open_year.family_id
       and y.calendar_year = open_year.calendar_year
  ) then
    raise exception 'this Family already has a % Year', open_year.calendar_year
      using errcode = 'PT409';
  end if;

  deadline := setup_deadline_for(open_year.calendar_year, fam.timezone, now());

  insert into years (family_id, calendar_year, status, center_mode, setup_deadline)
  values (open_year.family_id, open_year.calendar_year, 'setup', 'undecided', deadline)
  returning * into created;

  for member_row in
    select * from members
     where members.family_id = open_year.family_id and status = 'active'
  loop
    perform ensure_board(member_row.id, created.id);
  end loop;

  insert into votes (year_id, kind, closes_at) values
    (created.id, 'mode', deadline),
    (created.id, 'goal', deadline);

  return created;
end;
$$;

revoke execute on function open_year(uuid, int) from public, anon;
revoke execute on function ensure_board(uuid, uuid) from public, anon, authenticated;
grant execute on function open_year(uuid, int) to authenticated;
grant execute on function setup_deadline_for(int, text, timestamptz) to authenticated;
