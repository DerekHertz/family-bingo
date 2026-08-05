-- Slice 15, the half FRONTEND_DESIGN §4.8 asks for — which switches a Member gets, and
-- when a push is allowed to arrive.
--
-- §4.8: "Five switches, all of them somebody else's news: tile completed, bingo/blackout,
-- the Centre moves, swaps (off by default), the Almanac. Plus quiet hours (21:00–07:00,
-- batched into one line at 07:00)."
--
-- ---------------------------------------------------------------------------------
-- Two of the five have nothing behind them, and are therefore not built
-- ---------------------------------------------------------------------------------
--
-- `notifications.kind` is CHECK-constrained to exactly seven values — tile_completed,
-- bingo, blackout, join_requested, join_approved, setup_closing (22), digest (26) and
-- wrapped (27). Every writer of the table is one of four functions: notify_family(),
-- notify_account(), build_and_send_digest() and generate_wrapped(). Against that list:
--
--   tile completed   -> `tile_completed`.               Built.
--   bingo/blackout   -> `bingo` and `blackout`.         Built, as ONE switch, because
--                                                       §4.8 pairs them and a Member who
--                                                       wants a Bingo wants a Blackout.
--   the Almanac      -> `wrapped`, written by           Built.
--                       generate_wrapped() at freeze.
--   the Centre moves -> NOTHING. resolve_center_vote()  Not built.
--                       writes no notification and
--                       there is no kind for one.
--   swaps            -> NOTHING. swap_tile() writes a   Not built.
--                       Revision and a Feed row, and
--                       no notification.
--
-- A switch that controls nothing is worse than an absent one: it is a promise the app
-- silently breaks, and the Member who turns swaps off and still hears about them has
-- learned that the settings screen lies. The two missing switches need a server change
-- first — a new `kind`, a fan-out call at the point the event happens, and copy in the
-- notify function — and they belong to the slices that own those events, not to this one.
--
-- ---------------------------------------------------------------------------------
-- Preferences belong to the Account
-- ---------------------------------------------------------------------------------
--
-- Not to the Member, and this is the same argument api.md §6.1 makes about the outbox: a
-- device token hangs off an Account, one Account may be a Member of several Families, and
-- a phone cannot be told about Alice-in-the-Hertzells while staying quiet about
-- Alice-in-the-Okonkwos — there is one notification tray. `members.digest_opt_in` is the
-- deliberate exception and stays where it is: a Digest is one Family's week (§19.1), so
-- opting into it is a per-Family choice with a per-Family answer.
--
-- Managed Members therefore have no row here and cannot have one: they have no Account
-- (`account_id is null` — 20260801000001), which is FRONTEND_DESIGN §4.7's "Managed
-- Members receive no notifications" falling out of the schema rather than being restated.

create table notification_preferences (
  account_id      uuid primary key references accounts (id) on delete cascade,

  -- §15.1's list is the default, and the defaults are TRUE for a second reason as well:
  -- every one of these kinds is already being sent today. A preferences migration that
  -- defaulted a shipped push to off would be a silent feature removal dressed as a
  -- setting — nobody asked for the quiet, and nobody would know where the noise went.
  tile_completed  boolean not null default true,
  bingo_blackout  boolean not null default true,
  -- The Almanac, once a Year, at freeze (§20). See the note above about defaults; this is
  -- the rarest notification in the app and the one that reveals the whole payoff.
  almanac         boolean not null default true,

  -- §4.8's quiet hours, OFF by default and holding §4.8's window when switched on.
  --
  -- Off, because PRD §15's acceptance test is "they receive a push notification within 30
  -- seconds" and a default that holds every evening's Tile until 07:00 would fail it for
  -- ten hours a day without anyone choosing that. The window is stored rather than
  -- hardcoded so a picker can arrive later without a migration; nothing writes anything
  -- but 21:00–07:00 today.
  quiet_hours     boolean not null default false,
  quiet_start     time not null default '21:00',
  quiet_end       time not null default '07:00',

  updated_at      timestamptz not null default now(),

  -- A zero-length window is not "no quiet hours", it is an unanswerable question:
  -- within_quiet_hours() would have to decide whether 21:00–21:00 means never or always.
  -- `quiet_hours` is the switch; this keeps the window from becoming a second one.
  constraint quiet_window_is_not_empty check (quiet_start <> quiet_end)
);

comment on table notification_preferences is
  'FRONTEND_DESIGN §4.8. One row per Account. Three switches, because three of §4.8''s '
  'five have a notification kind behind them — the Centre moves and swaps do not, and an '
  'inert switch is worse than an absent one. Enforced by the trigger on notifications '
  'below (what is written) and by pending_notifications() (when it is sent).';

comment on column notification_preferences.quiet_hours is
  '§4.8. Holds a push until quiet_end in the FAMILY''s timezone (§8.3 T1), where the '
  'notify function batches everything held into one line. Off by default — see the table.';

-- Every Account has a row, always.
--
-- The alternative is a NULL-means-default rule, which writes the defaults twice: once in
-- the DDL above and once in every coalesce() that reads them. Two copies of a default is
-- two answers to "what does a new Member get", and they drift.
create or replace function seed_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_preferences (account_id) values (new.id)
      on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger accounts_seed_notification_preferences
  after insert on accounts
  for each row execute function seed_notification_preferences();

-- Accounts that already exist. Without this, everyone who signed in before today reads as
-- "no preferences" and the switches below would have to guess for them.
insert into notification_preferences (account_id)
select a.id from accounts a
    on conflict (account_id) do nothing;

create or replace function touch_notification_preferences()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notification_preferences_touch
  before update on notification_preferences
  for each row execute function touch_notification_preferences();

alter table notification_preferences enable row level security;

-- A Member's own settings, and nobody else's business — not even their Family's. The same
-- shape as `device_tokens_self_all`, and for the same reason: this row describes a handset
-- and a person, not a Family (PRD §8.1 P1). The negative test is in
-- supabase/tests/notification_preferences.test.sql (§8.1 P2): another Account gets ZERO
-- ROWS rather than an error, because a 403 would confirm the row exists.
create policy notification_preferences_self_all on notification_preferences
  for all to authenticated
  using (account_id = auth.uid()) with check (account_id = auth.uid());

-- No column scope here, and that is a considered answer rather than an oversight.
--
-- 20260801000007_grants.sql:46 column-scopes UPDATE on `members` because that table holds
-- columns a Member must never set — `role` (self-promotion past §3.3) and `family_id`
-- (straight through the §8.1 boundary) — and a row-level policy cannot see which columns
-- an UPDATE touched. This table holds nothing of that kind: every column except the
-- primary key IS the preference, and `account_id` is protected by the policy's WITH CHECK,
-- which refuses any row whose owner is not the caller. Scoping the grant here would only
-- break the upsert the client uses, which assigns account_id on the insert path.
--
-- No DELETE: deleting the row would silently restore every default, which is not something
-- a settings screen should be able to do by accident. Turning a switch back on is an
-- UPDATE.
grant select, insert, update on notification_preferences to authenticated;
-- The notify function reads these through pending_notifications(), which is definer, so
-- service_role needs nothing here.

-- ---------------------------------------------------------------------------------
-- Whether a row is written
-- ---------------------------------------------------------------------------------

-- Which kinds a switch actually governs.
--
-- Everything not named here answers true, and the omissions are deliberate:
--
--   join_requested  the Organizer is the only person who can act on it, and a Member
--                   waiting forever behind a switch somebody flipped in March is §3.3
--                   broken by a preference.
--   join_approved   the answer to a question the recipient asked.
--   setup_closing   the last chance to write a Goal on a Board that seals whether or not
--                   it is finished (§10.2). Not a reminder — the deadline cannot slip.
--   digest          already opt-in, already default off, and already per-Family
--                   (`members.digest_opt_in`, §19.1). A second switch over the top of it
--                   would be two answers to one question.
--
-- SECURITY DEFINER is load-bearing: this is called from inside the fan-out, where the
-- current role may be `authenticated`, and RLS on notification_preferences would hide the
-- recipient's row from the Member whose tap caused the Milestone — every preference would
-- read as its default.
create or replace function wants_notification(target_account uuid, notification_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case notification_kind
      when 'tile_completed' then p.tile_completed
      when 'bingo'          then p.bingo_blackout
      when 'blackout'       then p.bingo_blackout
      when 'wrapped'        then p.almanac
      else true
    end, true)
    from notification_preferences p
   where p.account_id = target_account;
$$;

-- The preference decides whether the row exists at all, and it decides it HERE rather
-- than in each of the four functions that write the outbox.
--
-- A WHERE clause in notify_family() and notify_account() would leave the Almanac switch
-- inert: `wrapped` rows are written by generate_wrapped() directly (27 §7, 29 §10), and
-- `digest` rows by build_and_send_digest(). Enforcing a preference in two of four writers
-- is how a switch comes to control nothing — the exact failure this file refuses to ship
-- for the Centre and for swaps. One trigger covers every writer, including the ones a
-- later slice adds.
--
-- Dropping the row rather than filtering the send is the right end of the pipe: an unsent
-- row would sit in the outbox forever, be retried five times, and count against the drain
-- batch that other people's news is waiting in.
create or replace function drop_unwanted_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if wants_notification(new.account_id, new.kind) then
    return new;
  end if;
  -- Not an error. A Member who turned this off is not a failure to be retried (§15.3).
  return null;
end;
$$;

create trigger notifications_respect_preferences
  before insert on notifications
  for each row execute function drop_unwanted_notification();

-- ---------------------------------------------------------------------------------
-- When it is sent
-- ---------------------------------------------------------------------------------

-- Is a local wall-clock time inside a quiet window?
--
-- Its own function because the window wraps midnight — 21:00–07:00 is `>= start OR < end`,
-- not `between` — and a wrapping range written inline in two places is a wrapping range
-- that gets it right in one of them. Pure and IMMUTABLE, so pgTAP can assert the boundary
-- directly instead of inferring it from a drain.
--
-- Half-open on purpose: 21:00 is quiet and 07:00 is not. §4.8 says the batch goes out AT
-- 07:00, so 07:00 has to be a moment when something can be sent.
create or replace function within_quiet_hours(
  local_time  time,
  quiet_start time,
  quiet_end   time
)
returns boolean
language sql
immutable
as $$
  select case
           when quiet_start < quiet_end
             then local_time >= quiet_start and local_time < quiet_end
           else local_time >= quiet_start or local_time < quiet_end
         end;
$$;

-- The drain's one query, and the whole of "when".
--
-- The notify Edge Function used to select from `notifications` directly. It cannot any
-- more, for two reasons and both of them are §4.8:
--
--   1. Quiet hours are a send-time decision that needs the FAMILY's timezone (§8.3 T1),
--      and a decision made in a Deno file is a decision with no pgTAP around it. The same
--      argument api.md §6.1 makes about who gets notified applies to when.
--   2. "A tap opens the Tile the notification is about, not the app." The outbox stores a
--      `milestone_id`; the route needs a Board and a Tile. That is two joins the database
--      can do once per row, or three round trips the function would make per drain.
--
-- Output columns are prefixed rather than named after the columns they carry, because a
-- RETURNS TABLE name that collides with a column in the FROM list is ambiguous — the same
-- trap that made `missing_position` in 20260801000026_digest.sql.
--
-- `at_time` exists so a test can stand at 22:30 without waiting until 22:30.
create or replace function pending_notifications(
  batch_size   int default 100,
  max_attempts int default 5,
  at_time      timestamptz default now()
)
returns table (
  notification_id   uuid,
  recipient_account uuid,
  notification_kind text,
  attempt_count     int,
  about_year        uuid,
  subject_name      text,
  route_board       uuid,
  route_tile        uuid,
  was_held          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id,
         n.account_id,
         n.kind,
         n.attempts,
         n.year_id,
         s.display_name,
         -- A Tile Milestone names its Tile; a Bingo and a Blackout name neither (§13.1,
         -- 20260801000003) — so the Board is reached through the Milestone's own Member
         -- and Year instead, and the tap still lands somewhere true.
         coalesce(t.board_id, b.id),
         ms.tile_id,
         -- Written while this Account was asleep, so the function knows what to batch into
         -- one line at 07:00 (§4.8). A row that arrived at noon is never batched, however
         -- many of them there are.
         coalesce(p.quiet_hours, false)
           and within_quiet_hours((n.created_at at time zone f.timezone)::time,
                                  coalesce(p.quiet_start, time '21:00'),
                                  coalesce(p.quiet_end,   time '07:00'))
    from notifications n
    join families f on f.id = n.family_id
    left join notification_preferences p on p.account_id = n.account_id
    left join members s on s.id = n.subject_member_id
    left join milestones ms on ms.id = n.milestone_id
    left join tiles  t on t.id = ms.tile_id
    left join boards b on b.member_id = ms.member_id and b.year_id = ms.year_id
   where n.sent_at is null
     and n.failed_at is null
     and n.attempts < max_attempts
     and not (
       coalesce(p.quiet_hours, false)
       and within_quiet_hours((at_time at time zone f.timezone)::time,
                              coalesce(p.quiet_start, time '21:00'),
                              coalesce(p.quiet_end,   time '07:00'))
     )
   order by n.created_at
   limit batch_size;
$$;

-- The outbox is not a client surface, and neither is anything that reads it. `notify` runs
-- as service_role; nobody else may ask what is queued for whom.
revoke execute on function wants_notification(uuid, text) from public, anon, authenticated;
revoke execute on function drop_unwanted_notification() from public, anon, authenticated;
revoke execute on function seed_notification_preferences() from public, anon, authenticated;
revoke execute on function pending_notifications(int, int, timestamptz)
  from public, anon, authenticated;
grant execute on function pending_notifications(int, int, timestamptz) to service_role;
