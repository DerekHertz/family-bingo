-- Slice 21, server half — Late joiners.
--
-- Acceptance test (PRD §21):
--   Given a Family with a sealed, active Year
--   When a new Member is approved in July
--   Then they get a Board with a 7-day personal Setup Window, inherit the already-
--   decided Center Tile, and play through December 31
--
-- Most of this slice was built in advance by the slices that needed to not break on it.
-- `ensure_board()` says in its own comment that it is called "from slice 21, the approval
-- of a Member who joins in July"; `boards.joined_late_at` and `personal_setup_deadline`
-- have been columns since slice 2; the second pass of seal_due_boards() already seals a
-- Board whose personal window ran out. What was missing is the thing that fills them in.
--
-- §21.5 — "no proration, no special-casing" — is why this is so small, and it works only
-- because §13.5 removed ranking. There is no standing to be behind in, so a Member who
-- joins in July needs no handicap, no adjusted Board and no separate scoring path. They
-- get 25 Tiles and the rest of the year, like everyone else.

-- ---------------------------------------------------------------------------------
-- §21.3 — how much of the Year is left
-- ---------------------------------------------------------------------------------
--
-- Passed to Sharpening so a July joiner is offered ~70 walks rather than 300 (§7.7).
-- The same computation as remainingYearFraction() in src/domain/setup-window.ts, exposed
-- here so the server can answer it rather than trusting a number the client worked out —
-- it decides what Targets get proposed, and a client that got it wrong would quietly hand
-- someone a Board they cannot finish.
create or replace function remaining_year_fraction(target_year_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, least(1,
    extract(epoch from freeze_instant(y.calendar_year, f.timezone) - now())
    / nullif(extract(epoch from freeze_instant(y.calendar_year, f.timezone)
                              - (make_timestamp(y.calendar_year, 1, 1, 0, 0, 0)
                                 at time zone f.timezone)), 0)
  ))
    from years y join families f on f.id = y.family_id
   where y.id = target_year_id
$$;

grant execute on function remaining_year_fraction(uuid) to authenticated;
grant execute on function remaining_year_fraction(uuid) to service_role;

-- ---------------------------------------------------------------------------------
-- The Board a July joiner gets
-- ---------------------------------------------------------------------------------
--
-- §21.2 is the requirement with teeth: "They inherit the Family's already-resolved Center
-- Tile. The Center Vote is NOT reopened — doing so would alter a Tile on every
-- already-sealed Board." So the Center is copied, never re-decided, and nothing here
-- touches `votes`.
--
-- This also closes the hole slice 12 left open and named. complete_family_goal() matches
-- Tile 12 on `family_goal_id`, so a Member whose Board was dealt after the seal was
-- silently skipped when the Family completed its shared Goal — they had a centre with
-- nothing stamped on it. Stamping it here is the fix, and it had to wait for the slice
-- that deals the Board.
create or replace function deal_late_joiner_board(new_member_id uuid)
returns boards
language plpgsql
security definer
set search_path = public
as $$
declare
  joiner members;
  yr     years;
  board  boards;
  fg     family_goals;
begin
  select * into joiner from members m where m.id = new_member_id;
  if joiner.id is null or joiner.status <> 'active' then
    return null;
  end if;

  -- The Year already under way, if there is one. A Member approved during the Setup
  -- Window is not a late joiner at all: open_year() has not run, or has, and either way
  -- they seal with everyone else on the Family's clock. Only a Year past its seal needs
  -- any of this.
  select * into yr from years y
   where y.family_id = joiner.family_id
     and y.sealed_at is not null
     and y.frozen_at is null
   order by y.calendar_year desc
   limit 1;

  if yr.id is null then
    return null;
  end if;

  select * into board from boards b
   where b.member_id = joiner.id and b.year_id = yr.id;
  if board.id is not null then
    return board;
  end if;

  board := ensure_board(joiner.id, yr.id);

  -- §21.1: seven days from approval, and §21.4's marker, which is what lets the Board say
  -- "joined July" so the Feed makes sense. Both are stamped in the same statement because
  -- one without the other is a Board that either never seals or never explains itself.
  update boards
     set joined_late_at = now(),
         personal_setup_deadline = now() + interval '7 days'
   where id = board.id
  returning * into board;

  -- §21.2. In a shared-mode Year the Centre is a Family Goal that was decided months ago;
  -- in a personal-mode Year it is theirs to author, and write_goal() already opens
  -- position 12 once center_mode is 'personal'.
  if yr.center_mode = 'shared' then
    select * into fg from family_goals f where f.year_id = yr.id;

    if fg.id is not null then
      update tiles set family_goal_id = fg.id
       where board_id = board.id and position = 12;

      -- And if the Family already finished it, their centre arrives complete. The Tile is
      -- the same Tile everyone else has, so it cannot read differently on their Board —
      -- and the Milestone is what the Feed and Wrapped count per person (§12.3).
      if fg.completed_at is not null then
        perform record_tile_completion(joiner.id, yr.id,
          (select t.id from tiles t where t.board_id = board.id and t.position = 12));
        perform record_line_milestones(board.id);
      end if;
    end if;
  end if;

  return board;
end;
$$;

-- A trigger rather than a change to approve_member(), for the reason slice 15 gave: any
-- path that activates a Member should deal them a Board, and slice 3's function stays
-- slice 3's.
--
-- Named to sort before members_notify_approved, so the Board exists by the time the
-- Member is told they are in.
create or replace function deal_board_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform deal_late_joiner_board(new.id);
  return null;
end;
$$;

create trigger members_deal_late_board
  after update of status on members
  for each row when (old.status = 'pending' and new.status = 'active')
  execute function deal_board_on_approval();

revoke execute on function deal_late_joiner_board(uuid) from public, anon, authenticated;
revoke execute on function deal_board_on_approval() from public, anon, authenticated;
