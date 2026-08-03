-- Review fixes for slices 15-21.
--
-- Eight defects found by reviewing the slices against the PRD and against this repo's own
-- standards. Each is named with the slice it belongs to; they are collected here rather
-- than distributed across seven already-open branches, because rebasing a stack that deep
-- would churn every PR under review for no reviewer's benefit.

-- ---------------------------------------------------------------------------------
-- 1. §15.5 (slice 15) — the actor, not just the subject
-- ---------------------------------------------------------------------------------
--
-- "Never notify the Member who caused the Milestone." notify_family() excluded the
-- Account behind the Member the Milestone is ABOUT, which is the same Account for every
-- path that goes through an Increment — and a different one for the path that does not.
--
-- complete_family_goal() records a tile_completed on every Board's Tile 12 (§12.3). Each
-- one fires this trigger with a different subject, and the only Account excluded is that
-- Board owner's. So the Member who marked the Family Goal done received N-1 pushes
-- telling her that N-1 people had completed a Tile she had just completed for them — and
-- through emit_line_milestones(), possibly N-1 Bingos as well. It is the single loudest
-- thing the app can do and it fires at the one moment a Family acts together.
--
-- auth.uid() is the actor for every client-driven path, and NULL for pg_cron, which is
-- exactly the distinction needed: a sweep has no actor to spare.
create or replace function notify_family(
  notification_kind   text,
  about_member_id     uuid,
  source_milestone_id uuid default null,
  about_year_id       uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  about           members;
  causing_account uuid;
  acting_account  uuid;
  recipients      int;
begin
  select * into about from members m where m.id = about_member_id;
  if about.id is null then
    return 0;
  end if;

  causing_account := coalesce(about.account_id, about.guardian_account_id);
  -- Null under pg_cron, and that is correct: nobody's thumb caused a sweep.
  acting_account  := auth.uid();

  insert into notifications (account_id, family_id, year_id, kind, subject_member_id, milestone_id)
  select distinct
         coalesce(m.account_id, m.guardian_account_id),
         about.family_id,
         about_year_id,
         notification_kind,
         about_member_id,
         source_milestone_id
    from members m
   where m.family_id = about.family_id
     and m.status = 'active'
     and coalesce(m.account_id, m.guardian_account_id) is distinct from causing_account
     and (acting_account is null
          or coalesce(m.account_id, m.guardian_account_id) is distinct from acting_account);

  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 2. §15.1 (slice 15) — every Organizer, not an arbitrary one
-- ---------------------------------------------------------------------------------
--
-- `limit 1` picked whichever Organizer the planner happened to return. Nothing constrains
-- a Family to one (remove_managed_member() counts them, so the schema expects several),
-- and a join request sitting in the inbox of the Organizer who is on holiday is a Member
-- waiting forever on a queue nobody told them about.
create or replace function enqueue_membership_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (account_id, family_id, kind, subject_member_id)
    select distinct coalesce(m.account_id, m.guardian_account_id),
           new.family_id, 'join_requested', new.id
      from members m
     where m.family_id = new.family_id
       and m.role = 'organizer' and m.status = 'active'
        on conflict do nothing;
    return null;
  end if;

  perform notify_account(
    coalesce(new.account_id, new.guardian_account_id), 'join_approved', new.family_id, new.id);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 3. §16.6 (slice 16) — the reaper nobody scheduled
-- ---------------------------------------------------------------------------------
--
-- The migration claimed "the gap between them is small and bounded". As shipped it was
-- unbounded: no cron entry, no webhook, nothing. `orphaned_objects` filled up and the
-- bytes stayed — which for this feature is the failure ADR-0005 spends its whole length
-- on. §16.6 was not met.
--
-- Scheduled here with pg_net, which is what lets pg_cron reach an Edge Function at all.
-- The same treatment for `notify`: a Database Webhook is configured in project settings
-- and cannot be asserted from a migration, so this is the backstop that makes the outbox
-- drain even if nobody sets one up. Both endpoints are idempotent, so a duplicate
-- invocation costs a wasted round trip and nothing else.
create or replace function invoke_edge_function(function_name text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  secret   text := current_setting('app.settings.service_role_key', true);
begin
  -- Unset in local development and in tests, where there is no Edge Runtime to call.
  -- Returning rather than raising keeps the cron job green instead of filling the log
  -- with failures nobody can act on.
  if base_url is null or secret is null then
    return null;
  end if;

  return net.http_post(
    url     := base_url || '/' || function_name,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || secret),
    body    := '{}'::jsonb
  );
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reap-attachments') then
    perform cron.unschedule('reap-attachments');
  end if;
  perform cron.schedule('reap-attachments', '*/5 * * * *',
                        $job$select invoke_edge_function('reap-attachments')$job$);

  if exists (select 1 from cron.job where jobname = 'drain-notifications') then
    perform cron.unschedule('drain-notifications');
  end if;
  perform cron.schedule('drain-notifications', '* * * * *',
                        $job$select invoke_edge_function('notify')$job$);

  if exists (select 1 from cron.job where jobname = 'finalize-wrapped') then
    perform cron.unschedule('finalize-wrapped');
  end if;
  perform cron.schedule('finalize-wrapped', '5 * * * *',
                        $job$select invoke_edge_function('wrap')$job$);
end;
$$;

-- ---------------------------------------------------------------------------------
-- 4. §19.3 (slice 19) — "activity" is more than Increments
-- ---------------------------------------------------------------------------------
--
-- The week was called empty when it had no Increments and no Milestones. CONTEXT.md
-- defines a Digest as "a weekly summary of the Family's Feed", and the Feed is "every
-- Increment, Milestone, Swap, vote outcome and Member arriving" — so a week in which
-- somebody swapped a Goal, or the Center Vote resolved, or a new Member arrived, was
-- silently suppressed. Those are the weeks a quiet Family most wants to hear about.
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
  others_     int;
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

  -- The rest of the Feed: Swaps, vote outcomes, Members arriving.
  select
    (select count(*) from revisions r join boards b on b.id = r.board_id
      where b.year_id = yr.id
        and r.created_at >= window_start and r.created_at < window_end)
  + (select count(*) from votes v
      where v.year_id = yr.id
        and v.resolved_at >= window_start and v.resolved_at < window_end)
  + (select count(*) from members m
      where m.family_id = yr.family_id and m.status = 'active'
        and m.joined_at >= window_start and m.joined_at < window_end)
  into others_;

  if increments_ = 0 and milestones_ = 0 and others_ = 0 then
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
  on conflict (year_id, week_start) do nothing
  returning * into built;

  if built.id is null then
    return 0;
  end if;

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
-- 5. §8.3 T1/T3 and §20.4 (slice 20) — months belong to the Family's timezone
-- ---------------------------------------------------------------------------------
--
-- "Biggest month" and "the month the Family was most active" bucketed on UTC. A Family in
-- America/Los_Angeles logging on the evening of 31 December had that tap counted into the
-- following January — a month outside the Year it belongs to. §8.3 T3: "Year means the
-- calendar year in the Family's timezone."
--
-- Two other fixes ride along, both from the same review:
--
--   * `worst_month_increments` was min() over months that HAD activity, so a Member idle
--     from February to November had a "worst month" of whatever their quietest active
--     month was, never zero. Best Comeback — best month minus worst — understated exactly
--     the Members it exists to find. The months of the Year are generated and joined, so
--     a silent month counts as the zero it was.
--
--   * comeback_delta was not computed here at all; the Edge Function derived it. §20.2
--     froze these numbers precisely so an Award's input would be reproducible from the
--     materialized Wrapped, and a value that exists only in transit is not. It is a
--     column now.
--
--   * §20.4 asks for "longest-running Goal". Only the span was stored, never which Goal.
-- Dropped rather than replaced: the return type gains columns, and Postgres will not
-- change one in place. The grant goes with it and is restored at the foot of this file.
drop function if exists member_year_stats(uuid);

create function member_year_stats(target_year_id uuid)
returns table (
  member_id                uuid,
  display_name             text,
  tiles_completed          int,
  lines_completed          int,
  blackout                 boolean,
  increments               int,
  biggest_month            text,
  biggest_month_increments int,
  worst_month_increments   int,
  comeback_delta           int,
  longest_goal_span_days   int,
  longest_goal_text        text,
  median_gap_days          numeric,
  notes                    int,
  photos                   int,
  swaps_used               int,
  first_bingo_at           timestamptz,
  most_exceeded_ratio      numeric,
  most_exceeded_goal       text,
  most_exceeded_target     int,
  most_exceeded_actual     int
)
language sql
stable
security definer
set search_path = public
as $$
  with zone as (
    select f.timezone, y.calendar_year
      from years y join families f on f.id = y.family_id
     where y.id = target_year_id
  ),
  board as (
    select b.id, b.member_id, b.swaps_used, m.display_name
      from boards b join members m on m.id = b.member_id
     where b.year_id = target_year_id
  ),
  increment as (
    select bo.member_id, i.id, i.occurred_at, i.note, t.id as tile_id, t.goal_id
      from board bo
      join tiles t on t.board_id = bo.id
      join increments i on i.tile_id = t.id
  ),
  -- Every month of the Year, so a month with no activity counts as zero rather than not
  -- existing (§8.3 T3 — the Family's calendar, in the Family's timezone).
  calendar as (
    select to_char(generate_series(
             make_date(z.calendar_year, 1, 1),
             make_date(z.calendar_year, 12, 1),
             interval '1 month'), 'YYYY-MM') as month
      from zone z
  ),
  active as (
    select i.member_id,
           to_char(date_trunc('month', i.occurred_at at time zone z.timezone), 'YYYY-MM') as month,
           count(*)::int as n
      from increment i cross join zone z group by 1, 2
  ),
  monthly as (
    select bo.member_id, c.month, coalesce(a.n, 0) as n
      from board bo
     cross join calendar c
      left join active a on a.member_id = bo.member_id and a.month = c.month
  ),
  gaps as (
    select member_id,
           extract(epoch from occurred_at
                   - lag(occurred_at) over (partition by member_id order by occurred_at))
             / 86400.0 as days
      from increment
  ),
  goal_span as (
    select distinct on (i.member_id)
           i.member_id, g.text,
           (extract(epoch from max(i.occurred_at) - min(i.occurred_at)) / 86400.0)::int as days
      from increment i join goals g on g.id = i.goal_id
     group by i.member_id, i.goal_id, g.text
     order by i.member_id,
              (extract(epoch from max(i.occurred_at) - min(i.occurred_at)) / 86400.0)::int desc,
              g.text
  ),
  exceeded as (
    select distinct on (i.member_id)
           i.member_id, g.text, g.target, count(*)::int as actual,
           count(*)::numeric / g.target as ratio
      from increment i join goals g on g.id = i.goal_id
     group by i.member_id, i.goal_id, g.text, g.target
    having count(*) >= g.target
     order by i.member_id, count(*)::numeric / g.target desc, g.text
  )
  select
    bo.member_id,
    bo.display_name,
    coalesce((select count(*)::int from milestones ms
               where ms.member_id = bo.member_id and ms.year_id = target_year_id
                 and ms.type = 'tile_completed'), 0),
    coalesce((select count(*)::int from milestones ms
               where ms.member_id = bo.member_id and ms.year_id = target_year_id
                 and ms.type in ('bingo', 'line_completed')), 0),
    exists (select 1 from milestones ms
             where ms.member_id = bo.member_id and ms.year_id = target_year_id
               and ms.type = 'blackout'),
    coalesce((select count(*)::int from increment where increment.member_id = bo.member_id), 0),
    (select month from monthly where monthly.member_id = bo.member_id
      order by n desc, month limit 1),
    coalesce((select max(n) from monthly where monthly.member_id = bo.member_id), 0),
    coalesce((select min(n) from monthly where monthly.member_id = bo.member_id), 0),
    coalesce((select max(n) - min(n) from monthly where monthly.member_id = bo.member_id), 0),
    (select days from goal_span where goal_span.member_id = bo.member_id),
    (select text from goal_span where goal_span.member_id = bo.member_id),
    (select percentile_cont(0.5) within group (order by days)
       from gaps where gaps.member_id = bo.member_id and days is not null),
    coalesce((select count(*)::int from increment
               where increment.member_id = bo.member_id and increment.note is not null), 0),
    coalesce((select count(*)::int from increment
               join attachments a on a.increment_id = increment.id
              where increment.member_id = bo.member_id), 0),
    bo.swaps_used,
    (select min(ms.created_at) from milestones ms
      where ms.member_id = bo.member_id and ms.year_id = target_year_id
        and ms.type = 'bingo'),
    (select ratio  from exceeded where exceeded.member_id = bo.member_id),
    (select text   from exceeded where exceeded.member_id = bo.member_id),
    (select target from exceeded where exceeded.member_id = bo.member_id),
    (select actual from exceeded where exceeded.member_id = bo.member_id)
  from board bo
  order by bo.member_id
$$;

-- ---------------------------------------------------------------------------------
-- 6. §13.5 / ADR-0001 (slice 20) — the ladder that got in through the timeline
-- ---------------------------------------------------------------------------------
--
-- §20.5 asks for "a timeline of Milestones" and the implementation gave one — filtered to
-- Bingo and Blackout, ordered by time. That is a chronological list of who got a Bingo
-- first, which is the one thing §13.5 names outright: "no leaderboard, no ordering of
-- Members by progress, no 'first to bingo'."
--
-- The filter was the bug, not the ordering. A timeline of every Milestone is the Family's
-- year — hundreds of Tiles completing, Lines closing among them — and reads as a story
-- rather than a race. §20.5's own words are "a timeline of Milestones", unqualified.
create or replace function family_year_cards(target_year_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with zone as (
    select f.timezone from years y join families f on f.id = y.family_id
     where y.id = target_year_id
  ),
  increment as (
    select i.id, i.occurred_at, t.goal_id
      from boards b
      join tiles t on t.board_id = b.id
      join increments i on i.tile_id = t.id
     where b.year_id = target_year_id
  )
  select jsonb_build_object(
    'increments', (select count(*) from increment),

    'units', coalesce((
      select jsonb_agg(jsonb_build_object('unit', unit_canonical, 'total', n)
                       order by n desc, unit_canonical)
        from (select g.unit_canonical, count(*)::int as n
                from increment join goals g on g.id = increment.goal_id
               where g.unit_canonical is not null
               group by g.unit_canonical) u
    ), '[]'::jsonb),

    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'increments', n)
                       order by n desc, category)
        from (select g.category, count(*)::int as n
                from increment join goals g on g.id = increment.goal_id
               where g.category is not null
               group by g.category) c
    ), '[]'::jsonb),

    -- The Family's calendar, in the Family's timezone (§8.3 T3).
    'busiest_month', (
      select to_char(date_trunc('month', i.occurred_at at time zone z.timezone), 'YYYY-MM')
        from increment i cross join zone z group by 1 order by count(*) desc, 1 limit 1),

    'family_goal', (
      select jsonb_build_object(
               'text', fg.text,
               'completed', fg.completed_at is not null,
               'completed_by', (select m.display_name from members m
                                 where m.id = fg.completed_by_member_id))
        from family_goals fg where fg.year_id = target_year_id),

    -- Every kind, unfiltered. See the note above: narrowing this to Bingo and Blackout
    -- turned a timeline into a ranking.
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member', m.display_name, 'type', ms.type, 'at', ms.created_at)
               order by ms.created_at)
        from milestones ms join members m on m.id = ms.member_id
       where ms.year_id = target_year_id
    ), '[]'::jsonb),

    'next_year', (select y.calendar_year + 1 from years y where y.id = target_year_id)
  )
$$;

-- ---------------------------------------------------------------------------------
-- 7. §20.7 (slice 20) — a missing Award must not cost the Family its Wrapped
-- ---------------------------------------------------------------------------------
--
-- finalize_wrapped() raised when a Member was uncovered. assignAwards() cannot produce
-- that — `showed_up` is its floor — so the raise could only fire when `boards` and the
-- Awards disagreed for some other reason. And when it did, the whole transaction rolled
-- back: no Awards, and no push for anybody, on a Wrapped whose cards had already been
-- committed by an earlier transaction. The Edge Function then retried identical input
-- forever, so §20.3's "every Member receives a push" never happened for that Family.
--
-- Refusing to publish is a worse outcome than the one it was preventing. The floor is
-- applied here instead, which is the same answer assignAwards() would have given.
create or replace function finalize_wrapped(year_id uuid, awards jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  wrap       wrapped;
  yr         years;
  recipients int;
begin
  select * into yr   from years   y where y.id = finalize_wrapped.year_id;
  select * into wrap from wrapped w where w.year_id = finalize_wrapped.year_id;

  if wrap.id is null then
    raise exception 'no Wrapped for that Year' using errcode = 'PT403';
  end if;

  if exists (select 1 from wrapped_awards a where a.wrapped_id = wrap.id) then
    return 0;
  end if;

  insert into wrapped_awards (wrapped_id, member_id, axis, label, detail)
  select wrap.id,
         (a ->> 'member_id')::uuid,
         a ->> 'axis',
         a ->> 'label',
         coalesce(a -> 'detail', '{}'::jsonb)
    from jsonb_array_elements(awards) a
      on conflict (wrapped_id, member_id, axis) do nothing;

  -- §20.7: every Member must receive at least one. Nobody is left out — and nobody's
  -- Family loses their Wrapped over it.
  insert into wrapped_awards (wrapped_id, member_id, axis, label, detail)
  select wrap.id, b.member_id, 'showed_up', 'Showed Up',
         jsonb_build_object('reason', 'floor')
    from boards b
   where b.year_id = yr.id
     and not exists (select 1 from wrapped_awards a
                      where a.wrapped_id = wrap.id and a.member_id = b.member_id)
      on conflict (wrapped_id, member_id, axis) do nothing;

  -- §20.3, and only to Members who played: a Wrapped about a Board they were never dealt
  -- is not their Year.
  insert into notifications (account_id, family_id, year_id, kind)
  select distinct coalesce(m.account_id, m.guardian_account_id),
         yr.family_id, yr.id, 'wrapped'
    from members m
    join boards b on b.member_id = m.id and b.year_id = yr.id
   where m.status = 'active';

  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 8. §21.1 × §20.1 (slice 21) — a window that outlives the Year
-- ---------------------------------------------------------------------------------
--
-- A Member approved on 28 December got seven days, to 4 January. The Year freezes on
-- 1 January, and seal_due_boards()'s straggler pass requires `frozen_at is null` — so
-- their Board never sealed, and a draft Board cannot be logged against. They were left
-- holding a Board that was permanently unplayable, in a Year that was permanently over.
--
-- Seven days or whatever is left of the Year, whichever is shorter. A Member who arrives
-- on 30 December gets a very short window, which is honest: there is very little Year to
-- get a window on.
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

  select * into yr
    from years y
   where y.family_id = joiner.family_id
     and y.sealed_at is not null
     and y.frozen_at is null
   order by y.calendar_year desc
   limit 1;

  if yr.id is null then
    return null;
  end if;

  -- A record variable cannot share an INTO list, so the timezone is fetched on its own.
  select f.timezone into zone from families f where f.id = yr.family_id;

  select * into board from boards b
   where b.member_id = joiner.id and b.year_id = yr.id;
  if board.id is not null then
    return board;
  end if;

  board := ensure_board(joiner.id, yr.id);

  deadline := least(now() + interval '7 days', freeze_instant(yr.calendar_year, zone));

  update boards
     set joined_late_at = now(),
         personal_setup_deadline = deadline
   where id = board.id
  returning * into board;

  if yr.center_mode = 'shared' then
    select * into fg from family_goals f where f.year_id = yr.id;

    if fg.id is not null then
      update tiles set family_goal_id = fg.id
       where board_id = board.id and position = 12;

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

-- ---------------------------------------------------------------------------------
-- 9. Grants (slices 15, 16) — verbs, and columns
-- ---------------------------------------------------------------------------------
--
-- 20260801000007_grants.sql column-scopes UPDATE on `members` and explains at length why
-- a row-level policy cannot: it cannot see which columns an UPDATE touched. The
-- service_role grants stopped at the verb, so a compromised Edge Function could rewrite
-- `kind`, `account_id` or `subject_member_id` on the outbox — adjacent to the reason
-- INSERT was withheld from it in the first place.
revoke update on notifications from service_role;
revoke update on orphaned_objects from service_role;
grant update (sent_at, failed_at, attempts) on notifications to service_role;
grant update (reaped_at, attempts) on orphaned_objects to service_role;

-- The outbox is a delivery queue, not shared history. `notifications_self_read` and its
-- grant were surface with no purpose: no api.md row describes them, no test asserts a
-- positive read, and the Feed is where a Member sees what happened (§14.2). RLS stays
-- enabled with no policy, which is how `orphaned_objects` says the same thing.
drop policy if exists notifications_self_read on notifications;
revoke select on notifications from authenticated;

revoke execute on function invoke_edge_function(text) from public, anon, authenticated;
revoke execute on function freeze_year(uuid) from authenticated;
revoke execute on function generate_wrapped(uuid) from authenticated;

-- ---------------------------------------------------------------------------------
-- 10. §20.4 (slice 20) — the card gains what the stats gained
-- ---------------------------------------------------------------------------------
--
-- `longest_goal_text` and `comeback_delta` are new columns above, and a card that does not
-- carry them leaves "longest-running Goal" as a number of days with no Goal attached.
create or replace function generate_wrapped(target_year_id uuid)
returns wrapped
language plpgsql
security definer
set search_path = public
as $$
declare
  yr    years;
  wrap  wrapped;
  stats record;
begin
  select * into yr from years y where y.id = generate_wrapped.target_year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  if yr.frozen_at is null then
    raise exception 'this Year has not frozen yet' using errcode = 'PT403';
  end if;

  select * into wrap from wrapped w where w.year_id = yr.id;
  if wrap.id is not null then
    return wrap;
  end if;

  insert into wrapped (year_id, family_cards)
  values (yr.id, family_year_cards(yr.id))
      on conflict (year_id) do nothing
  returning * into wrap;

  if wrap.id is null then
    select * into wrap from wrapped w where w.year_id = yr.id;
    return wrap;
  end if;

  for stats in select * from member_year_stats(yr.id) loop
    insert into wrapped_member_cards (wrapped_id, member_id, stats)
    values (wrap.id, stats.member_id, jsonb_build_object(
      'tiles_completed',        stats.tiles_completed,
      'tiles_total',            25,
      'lines_completed',        stats.lines_completed,
      'lines_total',            12,
      'blackout',               stats.blackout,
      'increments',             stats.increments,
      'biggest_month',          stats.biggest_month,
      'biggest_month_increments', stats.biggest_month_increments,
      'worst_month_increments', stats.worst_month_increments,
      'comeback_delta',         stats.comeback_delta,
      'longest_goal_span_days', stats.longest_goal_span_days,
      'longest_goal',           stats.longest_goal_text,
      'median_gap_days',        stats.median_gap_days,
      'notes',                  stats.notes,
      'photos',                 stats.photos,
      'swaps_used',             stats.swaps_used,
      'first_bingo_at',         stats.first_bingo_at,
      'most_exceeded', case when stats.most_exceeded_goal is null then null else
        jsonb_build_object('goal',   stats.most_exceeded_goal,
                           'target', stats.most_exceeded_target,
                           'actual', stats.most_exceeded_actual) end
    ))
    on conflict (wrapped_id, member_id) do nothing;
  end loop;

  return wrap;
end;
$$;

-- §8.2 — "encode as constraints, not conventions". The card shape was a convention held
-- only by the key list above, so a dropped key would have surfaced as a blank card months
-- later, on a Year that can no longer be regenerated.
alter table wrapped_member_cards add constraint stats_has_the_cards check (
  stats ?& array['tiles_completed', 'lines_completed', 'blackout', 'increments',
                 'biggest_month', 'longest_goal_span_days', 'notes', 'photos',
                 'swaps_used', 'most_exceeded']
);

revoke execute on function generate_wrapped(uuid) from authenticated;

grant execute on function member_year_stats(uuid) to service_role;
revoke execute on function member_year_stats(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 11. §21.3 (slice 21) — a function that cannot be tested against its twin
-- ---------------------------------------------------------------------------------
--
-- schema.md §5 sets the house rule for a TS/SQL duplicate: the two must agree, and a test
-- asserting the same value on both sides is the only thing holding them together.
-- freeze_instant() honours it. remaining_year_fraction() could not: it read now(), so no
-- test could put it at the same instant as remainingYearFraction()'s fixtures and compare.
--
-- The instant is a parameter now, defaulting to now() so every caller is unchanged.
drop function if exists remaining_year_fraction(uuid);

create function remaining_year_fraction(target_year_id uuid, at timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, least(1,
    extract(epoch from freeze_instant(y.calendar_year, f.timezone) - at)
    / nullif(extract(epoch from freeze_instant(y.calendar_year, f.timezone)
                              - (make_timestamp(y.calendar_year, 1, 1, 0, 0, 0)
                                 at time zone f.timezone)), 0)
  ))
    from years y join families f on f.id = y.family_id
   where y.id = target_year_id
$$;

grant execute on function remaining_year_fraction(uuid, timestamptz) to authenticated;
grant execute on function remaining_year_fraction(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------
-- 12. §14.1 (slice 14) — a tie-break that was not one
-- ---------------------------------------------------------------------------------
--
-- Found by a Feed test that failed roughly one run in four. year_of_joining() ordered
-- candidate Years by `created_at` alone, and two Years opened in the same transaction
-- share it exactly — `now()` is the transaction timestamp, not the statement's. The
-- planner then returned whichever it liked, so a founding Member's arrival landed in
-- 2027 or 2028 depending on the weather, and the Year-scoped Feed lost two events.
--
-- `calendar_year` is the meaningful order and cannot tie: `one_year_per_family` forbids
-- it. It is the tie-break in all three clauses, in the same direction as the timestamp
-- beside it.
create or replace function year_of_joining(target_family_id uuid, at timestamptz)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select y.id from years y
      where y.family_id = target_family_id
        and y.created_at <= at
        and (y.frozen_at is null or y.frozen_at > at)
      order by y.created_at desc, y.calendar_year desc limit 1),
    (select y.id from years y
      where y.family_id = target_family_id and y.created_at > at
      order by y.created_at asc, y.calendar_year asc limit 1),
    (select y.id from years y
      where y.family_id = target_family_id
      order by y.created_at desc, y.calendar_year desc limit 1)
  )
$$;
