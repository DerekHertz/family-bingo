-- The demo Account: what it is, what it may not do, and how often anyone may become it.
--
-- The app is deployed publicly so it can be linked from a CV, and sign-up is invite-only
-- (20260801000037). A stranger therefore cannot make an Account — which is the right
-- answer to "who may create data here" and the wrong answer to "what does a stranger see".
-- So there is one shared Account, seeded into one Family whose Year is frozen, and a
-- public Edge Function that mints a session for it and for nothing else.
--
-- READ-ONLY IS NOT NEW CODE, AND MOST OF IT IS NOT IN THIS FILE
-- ---------------------------------------------------------------------------------------
-- The demo Family's Year is frozen, and §20.1 already says what a frozen Year is:
-- "permanently read-only — no backdating". That is enforced and pgTAP-tested today:
--
--   * `tile_is_loggable()` (20260801000018) requires `y.frozen_at is null`, and both
--     `increments_own_insert` and `increments_own_delete` (20260801000005) route through
--     it — so a frozen Year is immutable in both directions, at RLS, not in a screen.
--   * `swap_tile()` (20260801000025) raises 42501 'this Year is frozen' before it checks
--     anything else.
--   * `write_goal()` (20260801000033) and `complete_family_goal()` (20260801000019) do the
--     same.
--
-- Nothing here re-implements any of that. Adding a second read-only mechanism would mean
-- two rules that can disagree, and the one that is already tested would not be the one
-- deciding.
--
-- WHAT §20.1 CANNOT REACH, AND WHY THIS FILE EXISTS
-- ---------------------------------------------------------------------------------------
-- A frozen Year makes the *game* immutable. It says nothing about the writes that are not
-- inside a Year, and an ordinary Member can make five of those:
--
--   1. `create_family()`   — any Account may create as many Families as it likes (§2.2).
--                            A shared public session that can do this is a shared public
--                            session that can fill a personal project's database, which is
--                            precisely what invite-only was added to prevent.
--   2. `redeem_invitation()` — would put the demo Account inside a real Family, and
--                            therefore inside its `visible_family_ids()`. That is §8.1
--                            broken by an invitation rather than by a query.
--   3. `create_managed_member()` — writes a new Member into the demo Family. A Guardian
--                            need not be the Organizer, so this one is reachable.
--   4. `members_self_update` — renames the demo Member. Cosmetic, but it is a name every
--                            later visitor then sees, so the marker on screen would be
--                            saying something untrue.
--   5. `delete_account()`  — deletes the demo Account, and the Family with it. One tap on
--                            §4.6's last row destroys the demo for everybody.
--
-- Everything the demo Account could otherwise reach is Organizer-only — inviting,
-- approving, removing, breaking a tie, and opening next Year from Wrapped's final card.
-- The demo Member is deliberately **not** the Organizer (see the seed script), so those
-- are refused by `is_organizer_of()` and need nothing here.
--
-- THE GUARD IS ON THE TABLES, NOT ON THE FIVE FUNCTIONS
-- ---------------------------------------------------------------------------------------
-- Three triggers, not five `create or replace function`s. Rewriting those functions would
-- mean restating bodies that later migrations have already replaced (`create_family` is
-- 09, `redeem_invitation` is 10, `delete_account` is 08) and keeping five copies of one
-- rule in step forever. Worse, it would only cover the paths that exist today: a sixth way
-- to insert a `members` row is a hole that reopens silently.
--
-- Every one of the five ends in an INSERT on `families`, an INSERT or UPDATE on `members`,
-- or a DELETE of the `accounts` row. Guarding those three is the same rule stated once, and
-- it covers a path nobody has written yet.
--
-- Deliberately NOT guarded, and it is worth saying which:
--
--   * `device_tokens`, `notification_preferences`, `digest_opt_in` — per-Account plumbing
--     that renders nowhere in a frozen Year and cannot be seen by the next visitor. A
--     demo Account with no handset receives nothing whatever these say.
--   * `ballots` and `proposals` — writable at RLS, but the Centre screen is only reachable
--     from a Board still in setup, and `cast_ballot()` refuses a resolved vote. A row
--     written there by hand through the API is invisible to every screen.
--
-- Guarding those too would be four more policies to keep in step with their originals, in
-- exchange for nothing anyone can see. The line is: **anything a later visitor would
-- notice is refused; anything only this session can see is not.**

create table demo_account (
  -- One row, enforced by the primary key — the same shape `signup_policy` uses, and for
  -- the same reason: a settings table that can hold two rows will eventually disagree with
  -- itself, and "which of these two is the demo" is not a question with a safe default.
  id         boolean primary key default true check (id),
  account_id uuid not null references accounts (id) on delete cascade,
  updated_at timestamptz not null default now()
);

-- Deliberately empty. The row is written by `scripts/seed-demo-family.mjs` against the one
-- environment that has a demo in it; a migration that named an Account id would be naming
-- a row that does not exist in CI, in a fresh `db reset`, or on anyone else's project.
comment on table demo_account is
  'The single shared Account the public demo signs in as. Written by '
  'scripts/seed-demo-family.mjs, never by a migration.';

-- Not the client's business, and not the anon key's. RLS on with no policy and no grant is
-- this schema's way of saying service-role only (schema.md §7.1) — the same shape
-- `notifications`, `orphaned_objects` and `signup_allowlist` use.
alter table demo_account enable row level security;

-- The question every guard below asks, as its own function.
--
-- `stable` rather than `immutable`: the answer changes when the demo is re-seeded, and a
-- planner that cached it across a statement would be caching a fact about a row.
--
-- Answers false for NULL without a special case, which is the case that matters most:
-- `auth.uid()` is NULL for `postgres`, for `service_role` and for the seed script, and all
-- three must be able to write the demo Family — they are what builds it.
create or replace function is_demo_account(candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from demo_account d where d.account_id = candidate
  );
$$;

revoke execute on function is_demo_account(uuid) from public, anon, authenticated;

comment on function is_demo_account(uuid) is
  'Whether an Account is the shared public demo Account. False for NULL, which is what '
  'the seed script and every service-role caller present.';

-- The refusal itself.
--
-- 42501 is insufficient_privilege, which is exactly what this is — a caller who may not do
-- this — and it is the SQLSTATE the rest of the schema already raises for "not yours"
-- (`swap_tile`, `open_year`, `create_family`). The client's failure-copy functions match on
-- SQLSTATE rather than on message text (HANDOFF), so a new code here would fall through
-- every one of them to "that didn't go through".
--
-- The message is a fact and not a scold (§0.3). Nobody should ever read it: the demo's
-- banner says the same thing in advance, and this is the floor under it.
create or replace function refuse_demo_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_demo_account(auth.uid()) then
    raise exception 'the demo Account cannot change anything'
      using errcode = '42501';
  end if;
  -- BEFORE DELETE hands back OLD; everything else hands back NEW. Returning NEW on a
  -- delete returns NULL, which silently cancels the row — a guard that quietly ate
  -- somebody else's account deletion would be far worse than the thing it guards.
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function refuse_demo_write() is
  'Refuses a write when the caller is the demo Account. See 20260801000039.';

-- `create_family()` — the one write that would let a public session grow the database.
create trigger families_refuse_demo_insert
  before insert on families
  for each row execute function refuse_demo_write();

-- `redeem_invitation()`, `create_managed_member()` and §4.6's rename, in one trigger.
-- INSERT and UPDATE together because the rule is about the caller, not about the verb.
create trigger members_refuse_demo_write
  before insert or update on members
  for each row execute function refuse_demo_write();

-- `delete_account()` deletes `auth.users`, and `accounts.id` references it `on delete
-- cascade` — so the cascade is what arrives here, and refusing it aborts the whole
-- transaction. Guarding the cascade rather than the function means the demo Account
-- survives *any* deletion path, including one written later.
--
-- The trigger cannot fire for the seed script's own teardown: that runs as `service_role`
-- through the admin API, where `auth.uid()` is NULL.
create trigger accounts_refuse_demo_delete
  before delete on accounts
  for each row execute function refuse_demo_write();

-- ---------------------------------------------------------------------------------------
-- Rate limiting the door
-- ---------------------------------------------------------------------------------------
--
-- `demo-login` takes no secret, deliberately: a secret shipped in a public web bundle is
-- readable with view-source, so it would be a secret in name only and would make the
-- function look safer than it is. What stands in the door instead is that it can only ever
-- produce a session for one Account, plus this.
--
-- Two caps, because they answer different attacks. The per-caller cap stops one visitor
-- minting sessions in a loop; the global cap bounds what the whole internet can spend of a
-- free-tier project's auth quota in ten minutes, which one distributed caller would walk
-- straight past.
--
-- A **fixed** window rather than a sliding one, and the cost is honest: a caller can spend
-- one window's allowance at the end of a window and the next one at its start, so the true
-- ceiling is twice the cap over a short enough span. A sliding window means keeping a row
-- per attempt; this keeps one row per caller per ten minutes, and twice the cap is still a
-- bound.
create table demo_login_attempts (
  -- **Never an IP address.** The Edge Function HMACs the client address with a key the
  -- database does not have, so this column is an opaque handle that groups a caller's
  -- attempts and identifies nobody. Storing visitors' addresses in order to rate-limit a
  -- demo would be collecting personal data to protect a page that holds none.
  --
  -- `'*'` is the global bucket, and it is deliberately in the same table: one upsert shape,
  -- one expiry rule, and no second table to forget to clean.
  caller       text not null,
  window_start timestamptz not null,
  attempts     int not null default 0,
  primary key (caller, window_start)
);

-- Service-role only, like every other table in this schema with no policy on it.
alter table demo_login_attempts enable row level security;

comment on table demo_login_attempts is
  'Fixed-window counters for the public demo-login function. `caller` is an HMAC of the '
  'client address, never the address itself; `*` is the global bucket.';

-- Ten minutes. Long enough that a page reload costs nothing, short enough that a caller
-- who has been refused is not locked out for an afternoon.
create or replace function demo_login_window() returns interval
language sql immutable as $$ select interval '10 minutes' $$;

-- Count one attempt and say whether it is allowed.
--
-- Counts **first**, then compares — so a caller who keeps knocking stays refused rather
-- than getting a fresh allowance the moment they stop being counted. A limiter that only
-- counts the attempts it permitted is a limiter that rewards hammering it.
-- The parameter is `handle` and not `caller`, which is the column's name, because
-- `on conflict (caller, …)` is index inference and cannot see a plpgsql variable of the
-- same name — it reports "column reference is ambiguous" and refuses to run at all.
create or replace function demo_login_allowed(handle text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Five is a visitor who reloaded, changed browser, and tried again. It is not a script.
  per_caller constant int := 5;
  -- Sixty in ten minutes is more traffic than this page will ever legitimately see, and it
  -- is well under GoTrue's own sign-in limits, which are the thing actually being
  -- protected.
  global_cap constant int := 60;
  window_len constant interval := demo_login_window();
  bucket     timestamptz;
  mine       int;
  everyone   int;
begin
  if handle is null or btrim(handle) = '' or handle = '*' then
    -- '*' is the global bucket's own name. A caller allowed to present it could spend
    -- everyone's allowance in one request.
    return false;
  end if;

  bucket := to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from window_len))
    * extract(epoch from window_len));

  -- Housekeeping here rather than in a cron job: this table is only ever touched by this
  -- function, so this is the one moment it is guaranteed to happen, and it costs an index
  -- scan over at most a few hundred rows.
  delete from demo_login_attempts a where a.window_start < bucket - window_len * 6;

  insert into demo_login_attempts (caller, window_start, attempts)
  values (handle, bucket, 1)
  on conflict (caller, window_start)
    do update set attempts = demo_login_attempts.attempts + 1
  returning attempts into mine;

  insert into demo_login_attempts (caller, window_start, attempts)
  values ('*', bucket, 1)
  on conflict (caller, window_start)
    do update set attempts = demo_login_attempts.attempts + 1
  returning attempts into everyone;

  return mine <= per_caller and everyone <= global_cap;
end;
$$;

-- The Edge Function calls this with the service key, and nobody else calls it at all.
-- `anon` holding execute would be a way to spend the global bucket without ever reaching
-- the function it protects.
revoke execute on function demo_login_allowed(text) from public, anon, authenticated;
grant execute on function demo_login_allowed(text) to service_role;

comment on function demo_login_allowed(text) is
  'Counts one demo-login attempt for an opaque caller handle and answers whether it is '
  'within the per-caller and global caps. See 20260801000039.';
