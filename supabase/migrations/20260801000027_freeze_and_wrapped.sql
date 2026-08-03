-- Slice 20, server half — Freeze and Wrapped.
--
-- Acceptance test (PRD §20):
--   Given an active Year with activity from 4 Members
--   When the clock passes December 31, 23:59:59 in the Family's timezone
--   Then the Year is frozen, further Increments are rejected, Wrapped is generated,
--   every Member receives a push, and each sees swipeable cards
--   And every Member has received at least one Award
--
-- Wrapped is not a closing ceremony. It lands in the gap between one Year freezing and
-- the next Setup Window opening, while families are still together over the holidays and
-- need a reason to write 24 more goals — for an annual app, being forgotten before year
-- two is the default outcome.
--
-- **The Awards are not computed here.** assignAwards() in src/domain/awards.ts is a
-- subtle algorithm — a coverage phase where the most constrained Member picks first,
-- ranks rather than score ratios so that negated axes cannot invert, ties sharing a rank
-- — and it is exhaustively unit-tested. Transcribing it into PL/pgSQL would be a second
-- copy of the one thing in this codebase least able to survive two copies, and §20.7
-- calls those rules load-bearing. So this file computes the STATS, which are ordinary
-- aggregation, and the `wrap` Edge Function calls the tested function and hands the
-- result back to finalize_wrapped(). The same split as `sharpen`, for the same reason.

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'tile_completed', 'bingo', 'blackout',
  'join_requested', 'join_approved', 'setup_closing', 'digest', 'wrapped'));

-- ---------------------------------------------------------------------------------
-- §20.1 — the Freeze
-- ---------------------------------------------------------------------------------
--
-- The instant is January 1 of the following year in the Family's own timezone (§8.3 T1),
-- which is the same instant freezeInstant() computes in src/domain/setup-window.ts.
create or replace function freeze_instant(calendar_year int, zone text)
returns timestamptz
language sql
immutable
as $$
  select (make_timestamp(calendar_year + 1, 1, 1, 0, 0, 0) at time zone zone)
$$;

-- Idempotent, because the sweep runs hourly and because a Year can only freeze once:
-- "Frozen Years are permanently read-only — no backdating" is a statement about the past
-- as much as the future.
create or replace function freeze_year(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr years;
begin
  select * into yr from years y where y.id = freeze_year.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  if yr.frozen_at is not null then
    return yr;
  end if;

  update years
     set frozen_at = now(), status = 'frozen'
   where id = yr.id
  returning * into yr;

  return yr;
end;
$$;

-- ---------------------------------------------------------------------------------
-- §20.4 — one Member's Year, reduced to numbers
-- ---------------------------------------------------------------------------------
--
-- Every field the personal cards render, plus every field assignAwards() compares. One
-- function rather than two, because a Member's card and their Award have to agree about
-- what they did.
create or replace function member_year_stats(target_year_id uuid)
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
  longest_goal_span_days   int,
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
  with board as (
    select b.id, b.member_id, b.swaps_used, m.display_name
      from boards b join members m on m.id = b.member_id
     where b.year_id = target_year_id
  ),
  tap as (
    select bo.member_id, i.id, i.occurred_at, i.note, t.id as tile_id, t.goal_id
      from board bo
      join tiles t on t.board_id = bo.id
      join increments i on i.tile_id = t.id
  ),
  monthly as (
    select member_id,
           to_char(date_trunc('month', occurred_at), 'YYYY-MM') as month,
           count(*)::int as n
      from tap group by 1, 2
  ),
  -- Days between consecutive taps, which is what "most consistent" compares. The median
  -- rather than the mean: one four-month gap should not erase eleven steady months.
  gaps as (
    select member_id,
           extract(epoch from occurred_at
                   - lag(occurred_at) over (partition by member_id order by occurred_at))
             / 86400.0 as days
      from tap
  ),
  -- First-to-last span on a single Goal (§20.4), which rewards sticking with something
  -- rather than doing a lot of it.
  goal_span as (
    select member_id, goal_id,
           extract(epoch from max(occurred_at) - min(occurred_at)) / 86400.0 as days
      from tap where goal_id is not null group by 1, 2
  ),
  -- Target vs actual on the Goal they most exceeded. Only completed Goals count: falling
  -- short of 200 is not an achievement, and 1 of 1 is not exceeding anything.
  exceeded as (
    select distinct on (tp.member_id)
           tp.member_id, g.text, g.target, count(*)::int as actual,
           count(*)::numeric / g.target as ratio
      from tap tp join goals g on g.id = tp.goal_id
     group by tp.member_id, tp.goal_id, g.text, g.target
    having count(*) >= g.target
     order by tp.member_id, count(*)::numeric / g.target desc, g.text
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
    coalesce((select count(*)::int from tap where tap.member_id = bo.member_id), 0),
    (select month from monthly where monthly.member_id = bo.member_id
      order by n desc, month limit 1),
    coalesce((select max(n) from monthly where monthly.member_id = bo.member_id), 0),
    coalesce((select min(n) from monthly where monthly.member_id = bo.member_id), 0),
    (select max(days)::int from goal_span where goal_span.member_id = bo.member_id),
    (select percentile_cont(0.5) within group (order by days)
       from gaps where gaps.member_id = bo.member_id and days is not null),
    coalesce((select count(*)::int from tap
               where tap.member_id = bo.member_id and tap.note is not null), 0),
    coalesce((select count(*)::int from tap
               join attachments a on a.increment_id = tap.id
              where tap.member_id = bo.member_id), 0),
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
-- §20.5 — the Family's Year
-- ---------------------------------------------------------------------------------
--
-- §20.8 applies to exactly one card here: a Goal that skipped Sharpening has no
-- `unit_canonical` and cannot be added to anything, so it is excluded from the unit
-- aggregation and from nowhere else. It still counts in every personal stat, every Award
-- and every Line — refusing to measure someone's Goal is not the same as refusing to
-- count it.
create or replace function family_year_cards(target_year_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with tap as (
    select i.id, i.occurred_at, t.goal_id
      from boards b
      join tiles t on t.board_id = b.id
      join increments i on i.tile_id = t.id
     where b.year_id = target_year_id
  )
  select jsonb_build_object(
    'increments', (select count(*) from tap),

    -- "Together you read 47 books and walked 2,100 times." Grouped on unit_canonical so
    -- that one Member's "Books" and another's "book" add up (CONTEXT.md, Unit).
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('unit', unit_canonical, 'total', n)
                       order by n desc, unit_canonical)
        from (select g.unit_canonical, count(*)::int as n
                from tap join goals g on g.id = tap.goal_id
               where g.unit_canonical is not null
               group by g.unit_canonical) u
    ), '[]'::jsonb),

    -- "Your year was 40% fitness."
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'increments', n)
                       order by n desc, category)
        from (select g.category, count(*)::int as n
                from tap join goals g on g.id = tap.goal_id
               where g.category is not null
               group by g.category) c
    ), '[]'::jsonb),

    'busiest_month', (
      select to_char(date_trunc('month', occurred_at), 'YYYY-MM')
        from tap group by 1 order by count(*) desc, 1 limit 1),

    'family_goal', (
      select jsonb_build_object(
               'text', fg.text,
               'completed', fg.completed_at is not null,
               'completed_by', (select m.display_name from members m
                                 where m.id = fg.completed_by_member_id))
        from family_goals fg where fg.year_id = target_year_id),

    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member', m.display_name, 'type', ms.type, 'at', ms.created_at)
               order by ms.created_at)
        from milestones ms join members m on m.id = ms.member_id
       where ms.year_id = target_year_id
         and ms.type in ('bingo', 'blackout')
    ), '[]'::jsonb),

    -- §20.6: the final card is not a stat.
    'next_year', (select y.calendar_year + 1 from years y where y.id = target_year_id)
  )
$$;

-- ---------------------------------------------------------------------------------
-- §20.2 — generated once at Freeze, and materialized
-- ---------------------------------------------------------------------------------
--
-- The one place in this codebase where storing a derived value is right, and only because
-- the Year underneath is frozen: the inputs can never change again (schema.md §3.1).
-- Everywhere the source data is still mutable, derive it.
--
-- Awards are deliberately absent. finalize_wrapped() adds them.
-- `target_year_id`, not `year_id`: ON CONFLICT cannot table-qualify its target, so a
-- parameter sharing a name with the column makes the clause ambiguous.
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

  -- Only for a Year whose inputs are settled. Generating early would materialize numbers
  -- that could still move, which is the one thing §20.2 is trading away derivation for.
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
      'longest_goal_span_days', stats.longest_goal_span_days,
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

-- ---------------------------------------------------------------------------------
-- §20.3, §20.7 — the Awards, and telling everyone at once
-- ---------------------------------------------------------------------------------
--
-- Takes the Awards rather than computing them, because assignAwards() is already written
-- and tested and must not exist twice. The shape is what that function returns:
--   [{ "member_id": uuid, "axis": text, "label": text, "detail": {} }, ...]
--
-- Awards and pushes land in ONE transaction. §20.3 wants the Family to experience Wrapped
-- together rather than trickling through it alone across a week, and a Member opening a
-- Wrapped whose Awards had not arrived yet would see the one card that is about them
-- missing.
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

  -- Idempotent. The sweep may see the same Year again before the Edge Function's write
  -- has been noticed, and a second round of pushes would be worse than none.
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

  -- §20.7: every Member must receive at least one. That is a property of assignAwards()
  -- and is tested there, but this is the last place it can be caught before a Family sees
  -- a Wrapped with somebody missing — the exact failure mode §20.7 says to test for.
  if exists (
    select 1 from boards b
     where b.year_id = yr.id
       and not exists (select 1 from wrapped_awards a
                        where a.wrapped_id = wrap.id and a.member_id = b.member_id)
  ) then
    raise exception 'every Member must receive at least one Award (§20.7)'
      using errcode = 'PT422';
  end if;

  insert into notifications (account_id, family_id, year_id, kind)
  select distinct coalesce(m.account_id, m.guardian_account_id),
         yr.family_id, yr.id, 'wrapped'
    from members m
   where m.family_id = yr.family_id and m.status = 'active';

  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

-- ---------------------------------------------------------------------------------
-- The sweep
-- ---------------------------------------------------------------------------------
--
-- Hourly, and for the same reason the Digest's is: midnight on December 31 is a different
-- instant in every timezone (§8.3 T1).
--
-- Freezing and generating are separate calls in one loop, so that a Year which froze but
-- whose Wrapped failed to build is picked up on the next pass rather than staying frozen
-- and empty forever.
create or replace function freeze_due_years()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  due    record;
  frozen int := 0;
begin
  for due in
    select y.id, y.calendar_year, y.frozen_at, f.timezone
      from years y join families f on f.id = y.family_id
     where y.status <> 'frozen' or not exists (select 1 from wrapped w where w.year_id = y.id)
  loop
    continue when now() < freeze_instant(due.calendar_year, due.timezone);

    if due.frozen_at is null then
      perform freeze_year(due.id);
      frozen := frozen + 1;
    end if;

    perform generate_wrapped(due.id);
  end loop;

  return frozen;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'freeze-due-years') then
    perform cron.unschedule('freeze-due-years');
  end if;
  perform cron.schedule('freeze-due-years', '0 * * * *', 'select freeze_due_years()');
end;
$$;

grant select on wrapped, wrapped_member_cards, wrapped_awards to service_role;
grant execute on function member_year_stats(uuid) to service_role;
grant execute on function finalize_wrapped(uuid, jsonb) to service_role;

revoke execute on function freeze_instant(int, text) from public, anon, authenticated;
revoke execute on function member_year_stats(uuid) from public, anon, authenticated;
revoke execute on function family_year_cards(uuid) from public, anon, authenticated;
revoke execute on function finalize_wrapped(uuid, jsonb) from public, anon, authenticated;
revoke execute on function freeze_due_years() from public, anon, authenticated;
revoke execute on function freeze_year(uuid) from public, anon;
revoke execute on function generate_wrapped(uuid) from public, anon;
