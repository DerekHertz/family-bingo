-- Slice 12, server half — Completing a Tile.
--
-- Acceptance test (PRD §12):
--   Given a Goal with target 3 and 2 Increments
--   When a third Increment is logged
--   Then the Tile is complete and a Milestone is recorded
--
-- Completion itself needs no code. A Tile is complete when COUNT(increments) >= target
-- (§12.1), derived on every read and never stored as a flag — a cached flag and an
-- append-only log will drift, and the log is the source of truth (§11.4). There is
-- nothing here to set.
--
-- What does need code is the Milestone: the moment of crossing, recorded once, so the
-- Family can be interrupted for it (§15.2). Lines, Bingo and Blackout are slice 13.
-- milestonesToEmit() in src/domain already derives all four from a Board and what has
-- been recorded; this slice wires up the first of them and leaves the rest to that
-- slice rather than half-building them here.

-- ---------------------------------------------------------------------------------
-- Recording a completion, once, whatever caused it
-- ---------------------------------------------------------------------------------
--
-- Both ways a Tile can complete end here: Increments reaching a Target, and a Family
-- Goal being marked done. One writer, so "exactly one Milestone" (§12.2) is enforced in
-- one place rather than argued twice.
--
-- The insert defers to the partial unique index `one_tile_completed_per_tile`, which is
-- what makes it idempotent: a replayed offline queue (§17.4) re-derives the same state
-- and records nothing the second time, and two Increments crossing the Target
-- concurrently race into the index rather than into a duplicate Feed entry.
--
-- Parameters are prefixed rather than named for their columns because the ON CONFLICT
-- target below is the one place a name cannot be function-qualified.
create or replace function record_tile_completion(
  owner_member_id uuid,
  owning_year_id  uuid,
  completed_tile_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into milestones (member_id, year_id, type, tile_id)
  values (owner_member_id, owning_year_id, 'tile_completed', completed_tile_id)
      on conflict (member_id, tile_id) where type = 'tile_completed' do nothing;
$$;

-- ---------------------------------------------------------------------------------
-- The crossing, recorded once
-- ---------------------------------------------------------------------------------
--
-- A trigger rather than something the client calls, for the reason the milestones read
-- policy already gives: a Bingo notification is a social claim and must not be
-- forgeable. `milestones` has no INSERT grant to `authenticated` at all, so the only
-- writer is the database itself, reacting to a log it can verify.
--
create or replace function emit_tile_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_count int;
  board_year   uuid;
  board_owner  uuid;
begin
  -- The Board's owner, not `new.member_id`. RLS forces the two equal for any client —
  -- increments_own_insert requires the Tile to belong to the Board of the Member being
  -- credited — but this function is SECURITY DEFINER and a privileged path does not pass
  -- through that policy. Attributing to the logger there would misfile the Milestone and,
  -- because one_tile_completed_per_tile is keyed on (member_id, tile_id), would let a
  -- second row exist for the same Tile — the one thing §12.2 forbids.
  select g.target, b.year_id, b.member_id
    into target_count, board_year, board_owner
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
  perform record_tile_completion(board_owner, board_year, new.tile_id);

  return null;
end;
$$;

-- AFTER INSERT only. Deleting an Increment can drop a Tile back below its Target, and
-- the Milestone deliberately stands: it was pushed to the Family's phones and cannot be
-- unsent, so withdrawing the row would only re-arm the interruption for the next time
-- the Member crosses the same line. The event happened. The Tile simply reads as
-- incomplete again, because completion is derived and the log moved.
create trigger increments_emit_completion
  after insert on increments
  for each row execute function emit_tile_completion();

-- ---------------------------------------------------------------------------------
-- §12.3 — the Family Goal completes for everyone at once
-- ---------------------------------------------------------------------------------
--
-- A Family Goal has no Target and takes no Increments (slice 11): it is marked done,
-- and completing it completes that Tile for every Member simultaneously (CONTEXT.md,
-- Family Goal). Any Member may mark it — it belongs to the Family, not to whoever
-- proposed it — and the Feed records who did.
--
-- Takes the acting Member rather than inferring it from auth.uid(), the same shape as
-- cast_ballot(): a Guardian marking it as their Managed Member is the normal case, and
-- the act is attributed to the Managed Member, not the Guardian (§4.2).
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
  -- are still drafts. Every other progress path is closed then — tile_is_loggable()
  -- requires a sealed Board — and this one must be too, or a Family could complete a
  -- Tile, and be interrupted for it, before the Year had begun.
  if yr.sealed_at is null then
    raise exception 'this Year has not been sealed yet' using errcode = 'PT403';
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
  -- Tile 12 was never stamped, so they are skipped here too. Fixing it means writing
  -- family_goal_id at approval time, which is slice 21's job and not reachable from
  -- here — nothing writes personal_setup_deadline yet.
  perform record_tile_completion(b.member_id, yr.id, t.id)
     from tiles t
     join boards b on b.id = t.board_id
    where b.year_id = yr.id
      and t.position = 12
      and t.family_goal_id = fg.id;

  return fg;
end;
$$;

revoke execute on function record_tile_completion(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function emit_tile_completion() from public, anon, authenticated;
revoke execute on function complete_family_goal(uuid, uuid) from public, anon;
grant execute on function complete_family_goal(uuid, uuid) to authenticated;
