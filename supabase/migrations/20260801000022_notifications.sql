-- Slice 15, server half — Push notifications.
--
-- Acceptance test (PRD §15):
--   Given a Member with push permission granted
--   When another Member in their Family completes a Tile
--   Then they receive a push notification within 30 seconds
--   And when that Member logs a bare Increment
--   Then no push is sent
--
-- An outbox, not a webhook. The trigger writes one row per recipient and the Edge
-- Function drains it, which is what makes §15.5 — "never notify the Member who caused
-- the Milestone" — a property the database can be tested on rather than behaviour buried
-- in a Deno file with no pgTAP around it. It also survives the Edge Function being down:
-- the rows wait.
--
-- §15.3 is the requirement most likely to be "improved" away, so the tiering lives in a
-- WHEN clause where breaking it means deleting something visible. A family of six
-- generates ~3,300 Increments a year; pushing them means ~80 notifications in the first
-- nine days, after which the Member turns notifications off AT THE OS LEVEL and the app
-- can never win them back. Notification permission is a one-way door.
--
-- Note which Milestone kinds are here and which are not. `line_completed` is deliberately
-- absent: §13.2 made it the quieter one and api.md §6 lists only Tile completed, Bingo
-- and Blackout as push-worthy. A Member closing their eighth Line is Feed news.
--
-- ---------------------------------------------------------------------------------
-- A deviation from §15.1, because the schema forbids the alternative
-- ---------------------------------------------------------------------------------
--
-- §15.1 lists "invite received" as a push. It cannot be sent. An Invitation stores only
-- `token_hash` — "the token itself lives in the link and nowhere else" (§3.1) — and
-- carries no email, so there is no identity in this database to address. That is a
-- deliberate privacy property and worth more than the notification.
--
-- What the schema can address is the other half of the same moment: someone has followed
-- a link and is waiting on the Organizer, who is the only person who can act. That is
-- `join_requested`. `join_approved` then goes to the person who was waiting.

create table notifications (
  id                 uuid primary key default gen_random_uuid(),
  -- The recipient is an ACCOUNT, not a Member: device tokens hang off Accounts, and one
  -- Account may be a Member of several Families.
  account_id         uuid not null references accounts (id) on delete cascade,
  family_id          uuid not null references families (id) on delete cascade,
  year_id            uuid references years (id) on delete cascade,
  kind               text not null check (kind in (
                       'tile_completed', 'bingo', 'blackout',
                       'join_requested', 'join_approved', 'setup_closing')),
  -- Who it is about. The Edge Function renders the copy; the database stores the facts,
  -- so that changing "Alice completed a Tile" to anything else is not a migration.
  subject_member_id  uuid references members (id) on delete cascade,
  milestone_id       uuid references milestones (id) on delete cascade,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  failed_at          timestamptz,
  attempts           int not null default 0
);

comment on table notifications is
  'PRD §15. The push outbox: one row per recipient Account, drained by the notify Edge '
  'Function. Only Milestones worth interrupting someone for reach it (§15.1) — never '
  'Increments (§15.2), and never line_completed, which §13.2 made the quiet one.';

-- The drain order, and the only query the Edge Function runs.
create index notifications_pending_idx on notifications (created_at)
  where sent_at is null and failed_at is null;
create index notifications_account_idx on notifications (account_id, created_at desc);
-- One setup_closing warning per Year, ever. The outbox is its own record of having
-- warned, so no column on `years` has to be kept in step with it.
create unique index one_setup_warning_per_year on notifications (year_id, account_id)
  where kind = 'setup_closing';

alter table notifications enable row level security;

-- A notification is addressed to one Account and is nobody else's business — not even
-- their Family's. Narrower than the Family-wide read the rest of the app uses, because
-- this table is a delivery queue rather than shared history; the Feed is where the
-- Family sees what happened (§14.2).
create policy notifications_self_read on notifications for select to authenticated
  using (account_id = auth.uid());

-- No INSERT grant, for the reason milestones has none: what a Family gets interrupted
-- for is not something a client may decide.
grant select on notifications to authenticated;

-- ---------------------------------------------------------------------------------
-- Fan-out
-- ---------------------------------------------------------------------------------
--
-- Every Account with an active Member in the Family, except the one that caused it.
--
-- "Except the Member who caused it" (§15.5) has to be resolved to an ACCOUNT, and that
-- is the whole subtlety. A Guardian logging for their Managed Member causes a Milestone
-- attributed to the child (§4.2) — so excluding `members.account_id` alone would push the
-- Guardian a notification about a tap they just made themselves. The backer is whichever
-- of the two columns is set (§4.1).
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
  about          members;
  causing_account uuid;
  recipients     int;
begin
  select * into about from members m where m.id = about_member_id;
  if about.id is null then
    return 0;
  end if;

  causing_account := coalesce(about.account_id, about.guardian_account_id);

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
     -- A pending Member reads nothing and hears nothing (§3.2). They have asked, not
     -- arrived, and a push about a Family they have not joined would be a leak.
     and m.status = 'active'
     and coalesce(m.account_id, m.guardian_account_id) is distinct from causing_account;

  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

-- One Account, addressed directly. Used where the recipient is the point rather than the
-- Family — being approved, or being asked to approve.
create or replace function notify_account(
  target_account_id  uuid,
  notification_kind  text,
  target_family_id   uuid,
  about_member_id    uuid default null,
  about_year_id      uuid default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (account_id, family_id, year_id, kind, subject_member_id)
  values (target_account_id, target_family_id, about_year_id, notification_kind, about_member_id)
      on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------------
-- §15.1 — what is worth interrupting someone for
-- ---------------------------------------------------------------------------------
--
-- The WHEN clause IS the tiering rule. An Increment never reaches this trigger because
-- it never becomes a Milestone (§15.2), and `line_completed` is excluded by name.
create or replace function enqueue_milestone_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_family(new.type, new.member_id, new.id, new.year_id);
  return null;
end;
$$;

create trigger milestones_notify
  after insert on milestones
  for each row when (new.type in ('tile_completed', 'bingo', 'blackout'))
  execute function enqueue_milestone_notification();

-- Joining, both sides of it. A trigger rather than a change to approve_member(), so that
-- any path which activates a Member is covered and slice 3's function stays slice 3's.
create or replace function enqueue_membership_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organizer_account uuid;
begin
  if tg_op = 'INSERT' then
    -- Someone followed a link and is waiting. Only the Organizer can act on it, so only
    -- the Organizer is told.
    select coalesce(m.account_id, m.guardian_account_id) into organizer_account
      from members m
     where m.family_id = new.family_id and m.role = 'organizer' and m.status = 'active'
     limit 1;

    if organizer_account is not null then
      perform notify_account(organizer_account, 'join_requested', new.family_id, new.id);
    end if;
    return null;
  end if;

  -- Approved. The person who was waiting is the one who wants to know.
  perform notify_account(
    coalesce(new.account_id, new.guardian_account_id), 'join_approved', new.family_id, new.id);
  return null;
end;
$$;

create trigger members_notify_requested
  after insert on members
  for each row when (new.status = 'pending')
  execute function enqueue_membership_notification();

create trigger members_notify_approved
  after update of status on members
  for each row when (old.status = 'pending' and new.status = 'active')
  execute function enqueue_membership_notification();

-- ---------------------------------------------------------------------------------
-- The 24-hour warning
-- ---------------------------------------------------------------------------------
--
-- Boards seal whether or not everyone has finished (CONTEXT.md, Setup Window), so this is
-- the last chance to write a Goal rather than a reminder about a deadline that can slip.
-- Everyone gets it, including Members who have finished — an empty Tile on a sealed Board
-- is the failure this prevents, and the Member who thinks they are done is exactly the
-- one who does not check.
--
-- Sent once per Year, and the outbox itself is the record of that: the partial unique
-- index refuses a second row rather than a column on `years` needing to be kept in step.
create or replace function notify_setup_closing()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  due     years;
  total   int := 0;
begin
  for due in
    select * from years y
     where y.status = 'setup'
       and y.setup_deadline > now()
       and y.setup_deadline <= now() + interval '24 hours'
  loop
    insert into notifications (account_id, family_id, year_id, kind)
    select distinct coalesce(m.account_id, m.guardian_account_id),
           due.family_id, due.id, 'setup_closing'
      from members m
     where m.family_id = due.family_id and m.status = 'active'
        on conflict do nothing;

    total := total + 1;
  end loop;

  return total;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-setup-closing') then
    perform cron.unschedule('notify-setup-closing');
  end if;
  perform cron.schedule('notify-setup-closing', '0 * * * *', 'select notify_setup_closing()');
end;
$$;

revoke execute on function notify_family(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function notify_account(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function enqueue_milestone_notification() from public, anon, authenticated;
revoke execute on function enqueue_membership_notification() from public, anon, authenticated;
revoke execute on function notify_setup_closing() from public, anon, authenticated;
