-- Slice 7, database half — the Sharpening rate limit (PRD §7.8).
--
-- 100 calls per Member per Year. Generous enough never to be hit in normal use — a
-- Member authors 24 Goals — and bounded against a runaway loop.

create table sharpen_usage (
  member_id  uuid not null references members (id) on delete cascade,
  year_id    uuid not null references years (id) on delete cascade,
  used       int  not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),

  primary key (member_id, year_id)
);

alter table sharpen_usage enable row level security;

-- The Family can see how much of the budget a Member has left; nobody writes this
-- table directly — consume_sharpen() owns it.
create policy sharpen_usage_read on sharpen_usage for select to authenticated
  using (member_id in (select visible_member_ids()));

grant select on sharpen_usage to authenticated;

create or replace function sharpen_limit_per_year()
returns int
language sql
immutable
as $$ select 100 $$;

create or replace function sharpen_budget_remaining(member_id uuid, year_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, sharpen_limit_per_year() - coalesce(
    (select u.used from sharpen_usage u
      where u.member_id = sharpen_budget_remaining.member_id
        and u.year_id = sharpen_budget_remaining.year_id), 0));
$$;

-- Spend one Sharpening call.
--
-- Called by the `sharpen` Edge Function only AFTER a successful model response, because
-- FRONTEND_DESIGN §4.2 is explicit that a failed call does not spend the Goal's sharpen
-- — a Member should not lose their one shot because the model timed out.
--
-- The consequence, stated plainly: a caller whose requests *always* fail is not bounded
-- by this counter. The Edge Function checks the remaining budget before calling the
-- model, so a runaway loop that succeeds is capped at 100; a runaway loop that fails
-- every time is capped only by Supabase's own function rate limits. Moving the increment
-- before the call would close that at the cost of §4.2, which is the worse trade for the
-- Member who is actually using the app.
-- Parameters are named target_* because ON CONFLICT resolves bare column names against
-- plpgsql variables first, and would bind the inference clause to the parameters.
create or replace function consume_sharpen(target_member_id uuid, target_year_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  already_used int;
begin
  -- The NULL check is not defensive noise. A caller who cannot SEE the Member they
  -- named gets NULL from their own subquery, and `null not in (...)` evaluates to NULL
  -- rather than true — so without this the guard falls through and the refusal arrives
  -- as a confusing not-null violation instead of a permission error.
  if target_member_id is null or target_year_id is null then
    raise exception 'that is not your Member' using errcode = '42501';
  end if;

  if target_member_id not in (select controlled_member_ids()) then
    raise exception 'that is not your Member' using errcode = '42501';
  end if;

  -- Checked BEFORE incrementing. sharpen_budget_remaining() clamps at zero so the
  -- number shown to a Member is never negative, which means it can never report an
  -- overspend either — the raw counter is the only thing that can.
  select coalesce(u.used, 0) into already_used
    from sharpen_usage u
   where u.member_id = target_member_id and u.year_id = target_year_id;

  if coalesce(already_used, 0) >= sharpen_limit_per_year() then
    raise exception 'Sharpening limit reached for this Year' using errcode = 'PT429';
  end if;

  insert into sharpen_usage (member_id, year_id, used)
  values (target_member_id, target_year_id, 1)
  on conflict (member_id, year_id)
    do update set used = sharpen_usage.used + 1, updated_at = now();

  return sharpen_budget_remaining(target_member_id, target_year_id);
end;
$$;

revoke execute on function consume_sharpen(uuid, uuid) from public, anon;
grant execute on function consume_sharpen(uuid, uuid) to authenticated;
grant execute on function sharpen_budget_remaining(uuid, uuid) to authenticated;
grant execute on function sharpen_limit_per_year() to authenticated;
