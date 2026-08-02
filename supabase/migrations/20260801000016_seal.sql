-- Slice 10, server half — Sealing.
--
-- The moment a draft Board becomes the Member's commitment for the Year (CONTEXT.md,
-- Sealing). Everything before it is free editing; everything after costs a Swap.
--
-- Nothing here is client-driven. `pg_cron` runs the sweep, which is the whole point:
-- the Setup Window closes on a date, not on a person remembering to press a button
-- (PRD §10.1). The same reasoning as §8.4 — never blockable by inaction — applied to
-- authoring rather than voting: an unfinished Board seals with empty Tiles (§10.2)
-- rather than holding four other people at the starting line.
--
-- Immutability after sealing (§10.3) needs no new machinery. `goals` and `tiles` have
-- read policies and no client write policies (rls migration), so the only ways in are
-- write_goal() and clear_goal() — both of which already refuse a sealed Board — and,
-- from slice 18, swap_tile().

create extension if not exists pg_cron;

-- Seal one Year: resolve the Center Vote, seal every Board, make the Year active.
--
-- The order is the one in api.md §7 and it is not interchangeable. Resolution writes
-- `family_goal_id` onto every Tile 12, and a Board sealed first would be sealed with an
-- empty centre.
--
-- Idempotent and safe to re-run (§10.4): a Year that has already sealed returns
-- unchanged, so a cron retry after a partial failure costs nothing.
create or replace function seal_year(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr years;
begin
  select * into yr from years where id = seal_year.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  -- auth.uid() is NULL when pg_cron calls this; a signed-in caller must be the Organizer.
  if auth.uid() is not null and not is_organizer_of(yr.family_id) then
    raise exception 'only the Organizer may seal a Year' using errcode = '42501';
  end if;

  -- §10.4. Checked before the deadline guard below, so re-running is always harmless
  -- while sealing early never is.
  if yr.sealed_at is not null then
    return yr;
  end if;

  -- Sealing is what the deadline is FOR. An Organizer who could seal early would be
  -- taking authoring time away from everyone else in the Family, silently, with no
  -- appeal — so the date decides, for them as much as for anyone.
  if now() < yr.setup_deadline then
    raise exception 'the Setup Window is still open' using errcode = 'PT403';
  end if;

  perform resolve_center_vote(yr.id);

  -- §10.2: whether or not authoring finished. An empty Tile is a Tile whose Goal has
  -- not been written yet, and slice 18 is how it gets written.
  --
  -- coalesce() is for the late joiner (§21.1): a Member approved in July gets a
  -- personal seven-day window, and the Year's own deadline is not theirs. Nobody has
  -- one at this point in the Year's life — the column exists and is always NULL until
  -- slice 21 — but the sweep below seals those Boards on their own clock, and this is
  -- the half of that pair which must not seal them early.
  update boards b
     set sealed_at = now()
   where b.year_id = yr.id
     and b.sealed_at is null
     and coalesce(b.personal_setup_deadline, yr.setup_deadline) <= now();

  update years
     set status = 'active', sealed_at = now()
   where id = yr.id
  returning * into yr;

  return yr;
end;
$$;

-- What `pg_cron` actually calls. Returns the number of Boards sealed.
--
-- Two passes, because a Board can come due on a clock of its own. The first seals Years
-- whose Setup Window has closed; the second catches a late joiner whose personal window
-- ran out inside an already-active Year (§21.1).
--
-- One Family's bad Year must not stop the sweep — every other Family is waiting on the
-- same job, and a Board that fails to seal is a Board nobody can play on. Failures are
-- logged and skipped; the next run tries again, which idempotence makes free.
create or replace function seal_due_boards()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  due    years;
  sealed int := 0;
  n      int;
begin
  for due in
    select * from years
     where status = 'setup' and now() >= setup_deadline
     order by setup_deadline
  loop
    begin
      perform seal_year(due.id);
      -- The loop only ever sees a Year in 'setup', which has never been sealed, so
      -- every sealed Board it now has was sealed by the call above.
      select count(*) into n from boards b
       where b.year_id = due.id and b.sealed_at is not null;
      sealed := sealed + n;
    exception when others then
      raise warning 'seal_year(%) failed: %', due.id, sqlerrm;
    end;
  end loop;

  update boards b
     set sealed_at = now()
    from years y
   where y.id = b.year_id
     and y.sealed_at is not null
     and y.frozen_at is null
     and b.sealed_at is null
     and b.personal_setup_deadline is not null
     and now() >= b.personal_setup_deadline;

  get diagnostics n = row_count;
  return sealed + n;
end;
$$;

-- Every five minutes. The deadline is midnight on 1 January in the Family's timezone,
-- which is the one moment of the year when this job's lag is visible to a whole Family
-- at once; five minutes of grace past midnight is a smaller wrong than an hourly job
-- that leaves a Board editable until 00:59.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'seal-due-boards') then
    perform cron.unschedule('seal-due-boards');
  end if;
  perform cron.schedule('seal-due-boards', '*/5 * * * *', 'select seal_due_boards()');
end;
$$;

revoke execute on function seal_year(uuid) from public, anon;
revoke execute on function seal_due_boards() from public, anon, authenticated;
grant execute on function seal_year(uuid) to authenticated;
