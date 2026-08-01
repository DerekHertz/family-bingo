-- The social side: Accounts, Families, Members, Invitations, device tokens.
--
-- Terms are defined in CONTEXT.md. The structure is schema.md §2; the constraints are
-- schema.md §3. Row Level Security arrives in 20260801000005_rls.sql — every table here
-- is created with RLS enabled and no policies, so it is closed until then.

-- An Account is the login identity, one per real person (CONTEXT.md).
-- It hangs off auth.users: PRD §1.2 forbids ever joining on email, because Apple
-- private-relay addresses change and are not unique per person. Join only on id.
create table accounts (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on column accounts.email is
  'Display and contact only. Never an identity key — see PRD §1.2.';

create table families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  -- Every Family has an IANA timezone; deadlines, freeze and digests resolve in it
  -- (PRD §8.3 T1).
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now()
);

-- A Member is a person's participation in ONE Family. Everything they own hangs off the
-- Member, never the Account, so nothing crosses a Family boundary (ADR-0001).
create table members (
  id                   uuid primary key default gen_random_uuid(),
  family_id            uuid not null references families (id) on delete cascade,
  account_id           uuid references accounts (id) on delete cascade,
  guardian_account_id  uuid references accounts (id) on delete cascade,
  display_name         text not null check (char_length(display_name) between 1 and 60),
  avatar_url           text,
  role                 text not null default 'member' check (role in ('organizer', 'member')),
  status               text not null default 'pending' check (status in ('pending', 'active')),
  digest_opt_in        boolean not null default false,  -- PRD §19.1: opt-in, default off
  joined_at            timestamptz not null default now(),

  -- A Member is EITHER a real Account OR guarded by one. Never both, never neither
  -- (PRD §4.1, schema.md §3). This is what makes a Managed Member impossible to
  -- accidentally give a login to.
  constraint member_has_exactly_one_backer
    check (num_nonnulls(account_id, guardian_account_id) = 1)
);

comment on column members.guardian_account_id is
  'Set for a Managed Member (a child). They have no email, password or session, and '
  'cannot be invited or promoted — see ADR-0003.';

-- A single-use, expiring link the Organizer creates for one specific person (PRD §3.1).
-- Only the hash is stored; the token itself lives in the link and nowhere else.
create table invitations (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references families (id) on delete cascade,
  token_hash            text not null unique,
  created_by_member_id  uuid not null references members (id) on delete cascade,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  used_at               timestamptz,
  revoked_at            timestamptz
);

create table device_tokens (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts (id) on delete cascade,
  token         text not null,
  platform      text not null check (platform in ('ios', 'android')),
  last_seen_at  timestamptz not null default now(),

  unique (account_id, token)
);

-- Indexes (schema.md §7).
create index members_family_status_idx on members (family_id, status);
create index members_account_idx on members (account_id) where account_id is not null;
create index members_guardian_idx on members (guardian_account_id) where guardian_account_id is not null;
create index invitations_open_token_idx on invitations (token_hash)
  where used_at is null and revoked_at is null;

alter table accounts       enable row level security;
alter table families       enable row level security;
alter table members        enable row level security;
alter table invitations    enable row level security;
alter table device_tokens  enable row level security;
