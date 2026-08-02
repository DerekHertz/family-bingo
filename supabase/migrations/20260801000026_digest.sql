-- Slice 19, server half — the Weekly Digest.
--
-- Acceptance test (PRD §19):
--   Given a Family with a week of activity and a Member opted in
--   When the weekly job runs
--   Then that Member receives one summary push and no others receive it
--
-- The Digest exists for the Member who wants a pull back into the game without a stream
-- of interruptions (CONTEXT.md). It is the only push in the app that is not an event —
-- everything else in `notifications` happened at a moment, and this one is a summary of a
-- week — which is why it is the only one with content of its own.
--
-- That content is computed ONCE per Family per week and stored, then pointed at by one
-- notification per opted-in Member. Computing it per recipient would be the same six
-- queries run six times to produce six identical answers, and would let two Members of
-- one Family receive digests that disagreed.

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'tile_completed', 'bingo', 'blackout',
  'join_requested', 'join_approved', 'setup_closing', 'digest'));

-- ---------------------------------------------------------------------------------
-- One week of a Family's life
-- ---------------------------------------------------------------------------------

create table digests (
  id               uuid primary key default gen_random_uuid(),
  year_id          uuid not null references years (id) on delete cascade,
  family_id        uuid not null references families (id) on delete cascade,
  -- The Family's own week, in the Family's own timezone (§8.3 T1). Stored rather than
  -- recomputed because it is also the dedup key: the hourly sweep must not send twice.
  week_start       timestamptz not null,
  week_end         timestamptz not null,
  increment_count  int not null,
  milestone_count  int not null,
  -- Milestones worth naming, newest first: [{member, type, goal}]. Rendered by the Edge
  -- Function, so changing the wording is a deploy rather than a migration.
  notable          jsonb not null default '[]'::jsonb,
  -- Members one Tile from closing a Line (§19.2): [{member, line_index, position}].
  near_line        jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),

  -- §19.1 is weekly, and this is what makes "weekly" true no matter how often the sweep
  -- runs.
  constraint one_digest_per_week unique (year_id, week_start)
);

comment on table digests is
  'PRD §19. One row per Family per week, built only when the week had activity (§19.3). '
  'The notification rows that point at it are per Member; this is per Family, so no two '
  'Members can be sent digests that disagree.';

alter table digests enable row level security;

-- A Digest is the Family's week. Family-wide read, like everything else the Family did.
create policy digests_read on digests for select to authenticated
  using (family_id in (select visible_family_ids()));

grant select on digests to authenticated;
-- The `digest` Edge Function reads it to render the push.
grant select on digests to service_role;

create index digests_year_week_idx on digests (year_id, week_start desc);

-- ---------------------------------------------------------------------------------
-- §19.2 — Members near a Line
-- ---------------------------------------------------------------------------------
--
-- The one piece of the Digest that is not a count, and the one worth reading: four of
-- five is the state where a nudge is worth something and where nothing else in the app
-- says anything. The Board shows a Line closed or not closed; only this notices "one
-- Tile away".
--
-- Built on the same two functions the Milestones are (board_lines,
-- board_completed_positions), so a Member is never told they are one Tile from a Line
-- that the Line detector would not agree closes.
-- `missing_position` rather than `position`, which is reserved in a RETURNS TABLE clause
-- even though it is a perfectly good column name on `tiles`.
create or replace function members_near_a_line(target_year_id uuid)
returns table (member_id uuid, display_name text, line_index int, missing_position int)
language sql
stable
security definer
set search_path = public
as $$
  select b.member_id, m.display_name, l.line_index, gaps.positions[1]
    from boards b
    join members m on m.id = b.member_id
   cross join lateral (select board_completed_positions(b.id) as done) d
   cross join lateral (select ln.line_index, ln.positions from board_lines() ln) l
   cross join lateral (
     select array_agg(p) as positions
       from unnest(l.positions) p
      where not (p = any(d.done))
   ) gaps
   where b.year_id = target_year_id
     -- Exactly one short. Two is not a nudge, it is a chore. (A closed Line aggregates to
     -- NULL here, and cardinality(NULL) is NULL, so it falls out on its own.)
     and cardinality(gaps.positions) = 1
     -- And the Tile they are short of has to be one they could actually finish. An empty
     -- Tile on a Board that sealed unfinished has no Target, and telling someone they are
     -- one Tile from a Line they cannot close without spending a Swap (§18.5) is a taunt.
     and exists (
       select 1 from tiles t join goals g on g.id = t.goal_id
        where t.board_id = b.id and t.position = gaps.positions[1]
     )
   order by b.member_id, l.line_index
$$;

-- ---------------------------------------------------------------------------------
-- Building one, and sending it
-- ---------------------------------------------------------------------------------
--
-- Returns the number of Members it was sent to, which is 0 for a week with no activity
-- (§19.3) and 0 for a Family where nobody opted in (§19.1). Both are ordinary, not
-- errors: a Digest nobody asked for and a Digest about nothing are the two ways this
-- feature turns into the thing it exists to avoid.
create or replace function build_and_send_digest(
  target_year_id uuid,
  window_start   timestamptz,
  window_end     timestamptz
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  yr          years;
  increments_ int;
  milestones_ int;
  built       digests;
  recipients  int;
begin
  select * into yr from years y where y.id = target_year_id;
  if yr.id is null then
    return 0;
  end if;

  select count(*) into increments_
    from increments i
    join tiles  t on t.id = i.tile_id
    join boards b on b.id = t.board_id
   where b.year_id = yr.id
     and i.created_at >= window_start and i.created_at < window_end;

  select count(*) into milestones_
    from milestones m
   where m.year_id = yr.id
     and m.created_at >= window_start and m.created_at < window_end;

  -- §19.3, and it is the first thing checked rather than the last. "Never send an empty
  -- digest" — a weekly reminder that nothing happened is a weekly reminder to uninstall.
  if increments_ = 0 and milestones_ = 0 then
    return 0;
  end if;

  insert into digests (year_id, family_id, week_start, week_end,
                       increment_count, milestone_count, notable, near_line)
  values (
    yr.id, yr.family_id, window_start, window_end, increments_, milestones_,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'member', m.display_name, 'type', ms.type, 'goal', g.text)
               order by ms.created_at desc)
        from milestones ms
        join members m on m.id = ms.member_id
        left join tiles t on t.id = ms.tile_id
        left join goals g on g.id = t.goal_id
       where ms.year_id = yr.id
         and ms.created_at >= window_start and ms.created_at < window_end
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'member', n.display_name, 'line_index', n.line_index,
               'position', n.missing_position))
        from members_near_a_line(yr.id) n
    ), '[]'::jsonb)
  )
  -- The sweep runs hourly and a week has one Digest (§19.1). A second attempt is a no-op,
  -- not an error, and must not re-send.
  on conflict (year_id, week_start) do nothing
  returning * into built;

  if built.id is null then
    return 0;
  end if;

  -- §19.1: opt-in, default off. `digest_opt_in` defaults false on `members`, so this
  -- clause is the whole of the requirement — and the acceptance test's "no others
  -- receive it" is the same clause read backwards.
  insert into notifications (account_id, family_id, year_id, kind)
  select distinct coalesce(m.account_id, m.guardian_account_id),
         yr.family_id, yr.id, 'digest'
    from members m
   where m.family_id = yr.family_id
     and m.status = 'active'
     and m.digest_opt_in;

  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

-- ---------------------------------------------------------------------------------
-- When
-- ---------------------------------------------------------------------------------
--
-- Sunday evening in the Family's own timezone (§8.3 T1), which is why the sweep is hourly
-- rather than weekly: one weekly cron fires at one instant, and that instant is Sunday
-- evening in at most one timezone. The unique index is what keeps hourly from meaning
-- hourly.
--
-- A frozen Year sends nothing. Wrapped is the story of a finished Year (§20) and a digest
-- arriving after it would be an anticlimax about a week in which nothing could have
-- happened.
create or replace function send_due_digests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  due        record;
  week_start timestamptz;
  sent       int := 0;
begin
  for due in
    select y.id as year_id, f.timezone
      from years y
      join families f on f.id = y.family_id
     where y.status = 'active' and y.frozen_at is null
  loop
    -- 18:00 Sunday, local. extract(dow) is 0 for Sunday.
    continue when extract(dow  from now() at time zone due.timezone) <> 0
              or  extract(hour from now() at time zone due.timezone) <> 18;

    week_start := (date_trunc('week', now() at time zone due.timezone)
                     - interval '1 day') at time zone due.timezone;

    sent := sent + build_and_send_digest(due.year_id, week_start, week_start + interval '7 days');
  end loop;

  return sent;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-due-digests') then
    perform cron.unschedule('send-due-digests');
  end if;
  perform cron.schedule('send-due-digests', '0 * * * *', 'select send_due_digests()');
end;
$$;

revoke execute on function members_near_a_line(uuid) from public, anon, authenticated;
revoke execute on function build_and_send_digest(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function send_due_digests() from public, anon, authenticated;
