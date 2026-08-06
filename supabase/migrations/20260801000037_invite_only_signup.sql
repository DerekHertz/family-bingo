-- Invite-only sign-up, enforced where an account is actually born.
--
-- The app is being deployed publicly so it can be linked from a CV, and Google sign-in is
-- open to anyone with a Google account. Without this, any visitor can create an Account,
-- create a Family, and upload photographs into a 1 GB bucket on a personal project with no
-- moderation, no reporting and no terms of service. That is a different thing to be
-- responsible for than one family's own photos (ADR-0005).
--
-- It is also a worse first impression than the demo: a stranger who signs up sees
-- twenty-five empty squares. The demo Family is what they are meant to see.
--
-- WHERE THIS IS ENFORCED, AND WHY IT IS NOT THE CLIENT
-- ---------------------------------------------------------------------------------------
-- In the trigger on `auth.users`, which is the single door every identity comes through —
-- Google, magic link, and any provider added later. A check in the sign-in screen would be
-- a check an attacker simply does not run: the Supabase auth endpoint is public and the
-- anon key is in every bundle. Same argument as ADR-0004 makes about RLS.
--
-- WHY `session_user`, AND WHAT IT CANNOT TELL YOU
-- ---------------------------------------------------------------------------------------
-- GoTrue connects as `supabase_auth_admin`. Verified empirically rather than assumed: a
-- real signup against the local stack reports `session_user = supabase_auth_admin`, while
-- a direct `insert into auth.users` reports `postgres`.
--
-- So the gate separates **GoTrue** from **direct SQL**, and that is the only distinction
-- available. It does *not* separate a public sign-up from an administrative one:
-- `POST /auth/v1/admin/users` is served on the same connection, and the rows the two paths
-- produce are byte-identical — same `raw_app_meta_data`, same confirmation columns, same
-- `is_sso_user`, same `invited_at`. That was probed both ways rather than assumed, after
-- an earlier version of this comment claimed otherwise and broke the integration suite.
--
-- The consequence is a property worth stating plainly rather than working around: **every
-- identity GoTrue creates is gated, including one an operator creates with the service
-- key.** An operator adds the address to the allowlist first. That is not a workaround, it
-- is what invite-only means — and it costs one insert, which `scripts/seed-sealed-board.mjs`
-- and the two integration suites now do.
--
-- Direct SQL is not gated, and cannot usefully be: `postgres` and `service_role` already
-- have unrestricted access to this database, including to the allowlist itself. Gating
-- them would protect nothing and would break 28 files of pgTAP fixtures. A caller arriving
-- through the API cannot choose to be one of those roles.
--
-- FAIL CLOSED
-- ---------------------------------------------------------------------------------------
-- `allowlist_only` defaults to **true**, and an empty allowlist therefore admits nobody
-- rather than everybody. The tempting alternative — "an empty list means open" — is a
-- fail-open: delete the last row by accident and sign-up silently opens to the internet.
-- Opening the door is an explicit one-line change, and it should be.

create table signup_allowlist (
  -- Stored lowercase and trimmed; the trigger normalises the incoming address the same
  -- way. Email is display and contact only and is never an identity key (§1.2) — this is
  -- the one place it decides anything, and only about who may create an Account at all.
  email      text primary key check (email = lower(btrim(email)) and email <> ''),
  -- Who this is, for whoever reads the table in six months.
  note       text,
  added_at   timestamptz not null default now()
);

comment on table signup_allowlist is
  'Addresses permitted to create an Account. Consulted only for sign-ups arriving through '
  'GoTrue (session_user = supabase_auth_admin); seeds, operators and tests are unaffected.';

-- One row, enforced by the primary key. A settings table that can hold two rows is a
-- settings table that will eventually disagree with itself.
create table signup_policy (
  id             boolean primary key default true check (id),
  allowlist_only boolean not null default true,
  updated_at     timestamptz not null default now()
);

insert into signup_policy (id) values (true);

comment on table signup_policy is
  'Whether sign-up is restricted to signup_allowlist. Defaults to true: an empty allowlist '
  'admits nobody, because the alternative fails open.';

-- Neither table is the client's business, and neither is readable by it.
--
-- RLS on with no policy and no grant is this schema''s way of saying "service role only"
-- (schema.md §7.1, and the same shape as `notifications` and `orphaned_objects`). The
-- allowlist is a list of family members' email addresses; publishing it would be a small
-- but gratuitous disclosure, and knowing whether an address is on it is exactly what a
-- prober would want.
alter table signup_allowlist enable row level security;
alter table signup_policy    enable row level security;

-- The decision, as its own function.
--
-- Extracted rather than written inline in the trigger for a reason that turned out to be
-- load-bearing: `postgres` is not a member of `supabase_auth_admin`, so pgTAP cannot
-- impersonate GoTrue and cannot reach the gated branch through the trigger at all. A rule
-- that can only be exercised in production is a rule nobody has tested.
--
-- So the trigger passes `session_user` in, and the decision is checkable for every caller
-- and every address without needing to *be* anyone. The real door is verified separately
-- and empirically, against a live signup on the local stack.
create or replace function signup_is_allowed(address text, arriving_as text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Not the public door. Seeds, operators and tests are not gated, and cannot be:
    -- these are roles that already have unrestricted access to the database, so gating
    -- them would protect nothing and break every fixture in the suite.
    arriving_as <> 'supabase_auth_admin'
    or not (select p.allowlist_only from signup_policy p where p.id)
    or exists (
      select 1 from signup_allowlist a
       where a.email = lower(btrim(coalesce(address, '')))
         and a.email <> ''
    );
$$;

revoke execute on function signup_is_allowed(text, text) from public, anon, authenticated;

-- Replaces the definition in 20260801000008_account_lifecycle.sql. The insert is unchanged;
-- everything above it is new.
create or replace function handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not signup_is_allowed(new.email, session_user) then
    -- 42501 is insufficient_privilege, which is what this is: a caller who may not do
    -- this. GoTrue surfaces it as a failed sign-up rather than a half-made Account,
    -- because the trigger is on the same transaction as the `auth.users` insert.
    raise exception 'that address is not on the invite list'
      using errcode = '42501';
  end if;

  insert into accounts (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Unchanged, and restated because `create or replace function` does not re-attach it.
-- (It is still attached — the trigger references the function by name — but stating it
-- here means the whole rule can be read in one file.)
comment on function handle_new_account() is
  'Creates the Account row, and refuses the sign-up entirely when the address is not on '
  'signup_allowlist and allowlist_only is set. See 20260801000037.';
