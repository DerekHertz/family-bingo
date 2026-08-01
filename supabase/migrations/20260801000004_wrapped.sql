-- Wrapped — the story of a finished Year, generated once at Freeze.
--
-- These tables MATERIALIZE statistics that could be computed from the log. That is
-- deliberate, and safe here for a reason that applies nowhere else in this schema: the
-- underlying Year is FROZEN, so the inputs can never change again. Wrapped is written
-- once and read many times, and it must render instantly (PRD §20.2, schema.md §3.1).
-- Everywhere the source data is still mutable, derive it.

create table wrapped (
  id            uuid primary key default gen_random_uuid(),
  year_id       uuid not null references years (id) on delete cascade,
  family_cards  jsonb not null default '[]'::jsonb,
  generated_at  timestamptz not null default now(),

  constraint one_wrapped_per_year unique (year_id)
);

create table wrapped_member_cards (
  id          uuid primary key default gen_random_uuid(),
  wrapped_id  uuid not null references wrapped (id) on delete cascade,
  member_id   uuid not null references members (id) on delete cascade,
  stats       jsonb not null default '{}'::jsonb,

  unique (wrapped_id, member_id)
);

-- A superlative handed to a Member. Awards sit on unrelated axes and there are always at
-- least as many as there are Members, so receiving one never means placing above anyone
-- (PRD §20.7, ADR-0006).
--
-- "Every Member gets at least one" is NOT expressible as a constraint — it is a property
-- of the generation algorithm, across rows that do not yet exist at insert time
-- (schema.md §3). It lives in assignAwards() and is verified by its tests.
create table wrapped_awards (
  id          uuid primary key default gen_random_uuid(),
  wrapped_id  uuid not null references wrapped (id) on delete cascade,
  member_id   uuid not null references members (id) on delete cascade,
  axis        text not null,
  label       text not null,
  detail      jsonb not null default '{}'::jsonb,

  constraint one_award_per_axis_per_member unique (wrapped_id, member_id, axis),
  constraint award_axis_known check (axis in (
    'most_increments', 'biggest_single_month', 'most_consistent',
    'longest_running_goal', 'best_comeback', 'most_photos', 'most_notes',
    'first_bingo', 'most_exceeded_target', 'quietest_achiever', 'showed_up'
  ))
);

comment on table wrapped_awards is
  'Deliberately NOT a ladder. There is no rank column and there must never be one: a '
  'single ordered list of Members is forbidden by PRD §13.5a. Wrapped runs days before '
  'next Year''s goal-setting, so whatever it celebrates is what the Family optimizes '
  'for in January — see ADR-0006.';

create index wrapped_member_cards_wrapped_idx on wrapped_member_cards (wrapped_id);
create index wrapped_awards_wrapped_idx on wrapped_awards (wrapped_id);

alter table wrapped               enable row level security;
alter table wrapped_member_cards  enable row level security;
alter table wrapped_awards        enable row level security;
