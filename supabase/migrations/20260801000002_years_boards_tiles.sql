-- The Year, the Board, and the 25 Tiles — plus the Center Vote that decides what the
-- middle square is.

create table years (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references families (id) on delete cascade,
  calendar_year   int  not null check (calendar_year between 2000 and 2200),
  status          text not null default 'setup'
                    check (status in ('setup', 'active', 'frozen')),
  -- 'undecided' until the Center Vote resolves (PRD §8).
  center_mode     text not null default 'undecided'
                    check (center_mode in ('shared', 'personal', 'undecided')),
  setup_deadline  timestamptz not null,
  sealed_at       timestamptz,
  frozen_at       timestamptz,
  created_at      timestamptz not null default now(),

  constraint one_year_per_family unique (family_id, calendar_year)
);

-- The single Goal a whole Family commits to, placed on every Member's Center Tile.
-- Completing it completes that Tile for everyone at once (PRD §12.3).
create table family_goals (
  id                      uuid primary key default gen_random_uuid(),
  year_id                 uuid not null references years (id) on delete cascade,
  text                    text not null check (char_length(text) between 1 and 200),
  completed_at            timestamptz,
  completed_by_member_id  uuid references members (id) on delete set null,

  unique (year_id)
);

-- A Goal is personal and lives on exactly one Tile.
create table goals (
  id              uuid primary key default gen_random_uuid(),
  text            text not null check (char_length(text) between 1 and 200),
  -- target = 1 IS the one-shot shape. There is no goal_type enum and no second code
  -- path — deliberately (PRD §6.2, ADR-0002).
  target          int  not null,
  unit            text check (char_length(unit) <= 30),
  unit_canonical  text,
  category        text,
  pace_hint       text,
  created_at      timestamptz not null default now(),

  constraint target_positive check (target >= 1),
  constraint category_known check (category is null or category in
    ('fitness', 'family', 'learning', 'money', 'health', 'creative', 'other'))
);

comment on column goals.pace_hint is
  'Display only (PRD §6.3, ADR-0002). Nothing in the codebase may branch on it — the '
  'moment a completion, progress or eligibility check reads it, cumulative-only has '
  'been quietly reversed.';

comment on column goals.unit_canonical is
  'Singular lowercase, inferred during Sharpening (PRD §7.10). Exists so Wrapped can '
  'group one Member''s "Books" with another''s "book". NULL for a Goal that skipped '
  'Sharpening — that Goal still counts everywhere except aggregate Wrapped cards.';

create table boards (
  id                        uuid primary key default gen_random_uuid(),
  member_id                 uuid not null references members (id) on delete cascade,
  year_id                   uuid not null references years (id) on delete cascade,
  sealed_at                 timestamptz,
  swaps_used                int not null default 0,
  -- A Member approved mid-Year gets a personal 7-day Setup Window (PRD §21.1) and a
  -- "joined July" marker so the Feed makes sense (§21.4).
  joined_late_at            timestamptz,
  personal_setup_deadline   timestamptz,
  created_at                timestamptz not null default now(),

  constraint one_board_per_member_per_year unique (member_id, year_id),
  -- Three Swaps per Member per Year, enforced in the database, not just the UI
  -- (PRD §18.1). A CHECK cannot reach another table, which is why this counter is one
  -- of only two deliberate denormalizations (schema.md §3.1).
  constraint swap_budget check (swaps_used between 0 and 3)
);

-- Exactly 25 Tiles per Board, positions 0-24, row-major (PRD §5.4).
create table tiles (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references boards (id) on delete cascade,
  position       int  not null,
  goal_id        uuid references goals (id) on delete set null,
  family_goal_id uuid references family_goals (id) on delete set null,

  constraint tile_position_range check (position between 0 and 24),
  constraint one_tile_per_position unique (board_id, position),
  -- A Tile holds at most one kind of Goal. Both null is legal: an unfilled draft, or an
  -- empty Tile on a Board that sealed unfinished (PRD §10.2).
  constraint tile_goal_source_exclusive check (num_nonnulls(goal_id, family_goal_id) <= 1),
  -- Only the Center Tile may hold a Family Goal.
  constraint family_goal_is_center_only check (family_goal_id is null or position = 12)
);

create table votes (
  id           uuid primary key default gen_random_uuid(),
  year_id      uuid not null references years (id) on delete cascade,
  kind         text not null check (kind in ('mode', 'goal')),
  status       text not null default 'open' check (status in ('open', 'resolved')),
  outcome      text,
  closes_at    timestamptz not null,
  resolved_at  timestamptz,

  unique (year_id, kind)
);

-- A candidate Family Goal. Max 3 per Member per vote (PRD §9.1) — enforced in the RPC,
-- since a CHECK cannot count sibling rows.
create table proposals (
  id          uuid primary key default gen_random_uuid(),
  vote_id     uuid not null references votes (id) on delete cascade,
  member_id   uuid not null references members (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 200),
  created_at  timestamptz not null default now()
);

-- One Member's vote, changeable until the Setup Window closes. Not casting one is an
-- abstention: silence never blocks an outcome, it only forfeits a say (PRD §8.2, §8.4).
create table ballots (
  id           uuid primary key default gen_random_uuid(),
  vote_id      uuid not null references votes (id) on delete cascade,
  member_id    uuid not null references members (id) on delete cascade,
  choice_mode  text check (choice_mode in ('shared', 'personal')),
  proposal_id  uuid references proposals (id) on delete cascade,
  updated_at   timestamptz not null default now(),

  -- Changing a vote is an UPDATE, not a second row.
  constraint one_ballot_per_member unique (vote_id, member_id),
  -- A mode Ballot picks a mode; a goal Ballot picks a Proposal. Never both, never neither.
  constraint ballot_has_exactly_one_choice
    check (num_nonnulls(choice_mode, proposal_id) = 1)
);

create index years_family_idx on years (family_id);
create index boards_year_idx on boards (year_id);
create index tiles_board_position_idx on tiles (board_id, position);
create index proposals_vote_idx on proposals (vote_id, created_at);
create index ballots_vote_idx on ballots (vote_id);

alter table years         enable row level security;
alter table family_goals  enable row level security;
alter table goals         enable row level security;
alter table boards        enable row level security;
alter table tiles         enable row level security;
alter table votes         enable row level security;
alter table proposals     enable row level security;
alter table ballots       enable row level security;
