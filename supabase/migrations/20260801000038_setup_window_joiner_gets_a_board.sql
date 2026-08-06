-- A Member approved during the Setup Window never got a Board. Ever.
--
-- Not a display problem and not a timing one: there is no `boards` row, so there is
-- nothing to write a Goal onto, and nothing later creates one.
--
-- `ensure_board()` is called from exactly **one** place — `open_year()`, for the Members
-- who are active at that instant. `deal_late_joiner_board()` handles arrivals but only
-- looks at a Year with `sealed_at is not null`. And `seal_year()` seals the Boards that
-- exist; it does not create missing ones. So an approval landing *between* opening and
-- sealing falls through all three, and the Member is locked out of that Year permanently.
--
-- Reproduced end to end before writing this: organizer 1 Board, approved joiner 0; then
-- the deadline forced and `seal_due_boards()` run — 1 Board sealed, joiner still 0.
--
-- This is the most likely moment for somebody to arrive. The Setup Window is exactly when
-- an Organizer invites the family, which is why it was found by two people trying to use
-- the app rather than by any of 900 assertions.
--
-- WHAT THE OLD CODE BELIEVED
-- ---------------------------------------------------------------------------------------
-- The comment in 20260801000028 states the right rule and then does not implement it:
--
--   > A Member approved during the Setup Window is not a late joiner at all: open_year()
--   > has not run, or has, and either way they seal with everyone else on the Family's
--   > clock.
--
-- The "or has" is the hole. If `open_year()` has already run, nothing deals them in.
--
-- WHAT THIS DOES
-- ---------------------------------------------------------------------------------------
-- Every unsealed Year is dealt first, and a Member approved into one gets an **ordinary**
-- Board: no `joined_late_at`, no `personal_setup_deadline`, no §21.4 marker. They are not
-- a late joiner — they arrived while everyone was still writing, and they seal on the
-- Family's own clock (§21.1 is about a Year already under way).
--
-- The Centre is deliberately not copied on this path. The Centre Vote has not resolved
-- while the Year is in setup, so there is nothing to copy; `seal_year()` calls
-- `resolve_center_vote()` and stamps every Board's Tile 12 for the whole Family, including
-- this one. Copying anything here would be inventing a Centre before the Family chose it.

create or replace function deal_late_joiner_board(new_member_id uuid)
returns boards
language plpgsql
security definer
set search_path = public
as $$
declare
  joiner   members;
  yr       years;
  zone     text;
  board    boards;
  fg       family_goals;
  deadline timestamptz;
begin
  select * into joiner from members m where m.id = new_member_id;
  if joiner.id is null or joiner.status <> 'active' then
    return null;
  end if;

  -- **Every unsealed Year first**, and there can genuinely be more than one situation in
  -- play at once: §5.1 lets a Family open next year while this one is still running, which
  -- is the ordinary December case. A Member arriving then is owed a Board in *both* — an
  -- ordinary one in the Year still being written, and a late joiner's in the Year under
  -- way. Returning after the first one is what broke `late_joiners.test.sql`, which builds
  -- exactly that shape.
  --
  -- These are plain Boards: no marker, no personal deadline. They seal with everyone else
  -- on the Family's clock, and the Centre is left alone because the vote has not resolved
  -- — `seal_year()` stamps Tile 12 for the whole Family, this Board included.
  for yr in
    select * from years y
     where y.family_id = joiner.family_id
       and y.sealed_at is null
       and y.frozen_at is null
  loop
    board := ensure_board(joiner.id, yr.id);
  end loop;

  -- Then the Year already under way, which is §21's actual subject.
  select * into yr from years y
   where y.family_id = joiner.family_id
     and y.sealed_at is not null
     and y.frozen_at is null
   order by y.calendar_year desc
   limit 1;

  -- No sealed Year: whatever ordinary Board was dealt above is the answer, or null if the
  -- Family has no open Year at all.
  if yr.id is null then
    return board;
  end if;

  select f.timezone into zone from families f where f.id = yr.family_id;

  select * into board from boards b
   where b.member_id = joiner.id and b.year_id = yr.id;
  if board.id is not null then
    return board;
  end if;

  board := ensure_board(joiner.id, yr.id);

  -- §21.1's seven days, clamped to the Freeze (…_029 §8): a Member approved on 28 December
  -- would otherwise get a window outliving the Year and a Board that could never be played.
  deadline := least(now() + interval '7 days', freeze_instant(yr.calendar_year, zone));

  update boards
     set joined_late_at = now(),
         personal_setup_deadline = deadline
   where id = board.id
   returning * into board;

  -- §21.2 — the Centre is inherited, never re-decided. Reopening the vote would alter a
  -- Tile on every Board that had already sealed.
  select * into fg from family_goals g where g.year_id = yr.id;
  if fg.id is not null then
    update tiles set family_goal_id = fg.id
     where board_id = board.id and position = 12;

    -- And if the Family has already finished it, this Board's Centre is already complete.
    if fg.completed_at is not null then
      perform record_tile_completion(joiner.id, yr.id,
        (select t.id from tiles t where t.board_id = board.id and t.position = 12));
      perform record_line_milestones(board.id);
    end if;
  end if;

  return board;
end;
$$;

revoke execute on function deal_late_joiner_board(uuid) from public, anon, authenticated;

-- Repair the Families this already happened to.
--
-- Every active Member of an unsealed, unfrozen Year who has no Board gets one now. Written
-- as a backfill rather than left to the fixed trigger because the trigger only fires on the
-- pending → active transition, which has already happened for them — the app would tell
-- them to write their goals and give them nowhere to do it, forever.
do $backfill$
declare
  m record;
  dealt int := 0;
begin
  for m in
    select mem.id as member_id, y.id as year_id
      from members mem
      join years y on y.family_id = mem.family_id
     where mem.status = 'active'
       and y.sealed_at is null
       and y.frozen_at is null
       and not exists (
         select 1 from boards b where b.member_id = mem.id and b.year_id = y.id)
  loop
    perform ensure_board(m.member_id, m.year_id);
    dealt := dealt + 1;
  end loop;
  raise notice 'dealt % missing Board(s) for Members approved during a Setup Window', dealt;
end $backfill$;
