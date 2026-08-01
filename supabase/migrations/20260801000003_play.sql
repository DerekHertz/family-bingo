-- Playing: Increments, Attachments, Milestones, Revisions.

-- A single recorded instance of doing a Goal — one walk, one book.
--
-- The primary key is CLIENT-GENERATED (PRD §11.2). That one decision is what makes the
-- offline queue safe: the insert is an upsert on the id, Increments are append-only, and
-- so two devices adding rows can never disagree. No conflict resolution exists anywhere
-- in this codebase because none is needed (§17.4, ADR-0002).
create table increments (
  id           uuid primary key,
  tile_id      uuid not null references tiles (id) on delete cascade,
  member_id    uuid not null references members (id) on delete cascade,
  note         text check (char_length(note) <= 2000),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table increments is
  'Append-only (PRD §11.3). No edits. A mistake is corrected by deleting the row, which '
  'is the only mutation permitted. Progress is COUNT(*) and is never denormalized '
  '(§11.4) — a cached count and an append-only log will drift, and the log wins.';

-- A photo a Member optionally hangs on an Increment. Visible only to their Family, and
-- never outside it (ADR-0005). The object itself lives in a private Storage bucket at
-- attachments/{family_id}/{increment_id} — see 20260801000006_storage.sql.
create table attachments (
  id            uuid primary key default gen_random_uuid(),
  increment_id  uuid not null references increments (id) on delete cascade,
  storage_path  text not null,
  width         int,
  height        int,
  bytes         int,
  created_at    timestamptz not null default now(),

  constraint one_attachment_per_increment unique (increment_id)
);

-- An event rare and meaningful enough to interrupt someone for. Only Milestones are
-- pushed to phones; everything else waits in the Feed (PRD §15.1, §15.2).
--
-- The row IS the event, and the Board's Bingo/Blackout state is its consequence
-- (schema.md §3.1). The client gates its completion animation on the insert rather than
-- on count >= target, so an offline replay cannot re-fire it (FRONTEND_DESIGN §5).
create table milestones (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,
  year_id     uuid not null references years (id) on delete cascade,
  type        text not null
                check (type in ('tile_completed', 'bingo', 'line_completed', 'blackout')),
  tile_id     uuid references tiles (id) on delete cascade,
  line_index  int,
  created_at  timestamptz not null default now(),

  constraint line_index_range check (line_index is null or line_index between 0 and 11),
  -- A Tile Milestone names a Tile; a Line Milestone names a Line.
  constraint milestone_subject_matches_type check (
    case type
      when 'tile_completed' then tile_id is not null and line_index is null
      when 'blackout'       then line_index is null
      else line_index is not null
    end
  )
);

-- Exactly one tile_completed per Tile, one Milestone per Line, one Blackout per Year.
-- These are the database half of PRD §12.2: milestonesToEmit() will not re-emit, and if
-- an offline replay races it anyway, the insert is rejected rather than duplicated.
create unique index one_tile_completed_per_tile
  on milestones (member_id, tile_id) where type = 'tile_completed';
create unique index one_milestone_per_line
  on milestones (member_id, year_id, line_index) where type in ('bingo', 'line_completed');
create unique index one_blackout_per_year
  on milestones (member_id, year_id) where type = 'blackout';
-- A Member has at most one Bingo, ever: the first Line they close (PRD §13.2).
create unique index one_bingo_per_year
  on milestones (member_id, year_id) where type = 'bingo';

-- The permanent record of a Swap: what the Tile said before, what it says now, and when.
-- Never deleted — it is what makes a Bingo checkable rather than merely claimed
-- (CONTEXT.md, PRD §18.4).
create table revisions (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references boards (id) on delete cascade,
  tile_id        uuid not null references tiles (id) on delete cascade,
  before_text    text,
  before_target  int,
  after_text     text not null,
  after_target   int  not null,
  created_at     timestamptz not null default now()
);

-- Keeps boards.swaps_used honest. The counter is enforced by a CHECK, which cannot
-- reach another table, so the trigger is what ties it to the Revision log
-- (schema.md §3.1). A Swap over budget fails on the CHECK, inside this transaction.
create or replace function bump_swaps_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update boards set swaps_used = swaps_used + 1 where id = new.board_id;
  return new;
end;
$$;

create trigger revisions_bump_swaps_used
  after insert on revisions
  for each row execute function bump_swaps_used();

-- Indexes (schema.md §7). The first one matters most: it backs every progress count in
-- the app, and progress is deliberately not denormalized.
create index increments_tile_idx on increments (tile_id);
create index increments_member_created_idx on increments (member_id, created_at desc);
create index milestones_year_created_idx on milestones (year_id, created_at desc);
create index revisions_board_idx on revisions (board_id, created_at desc);
create index attachments_increment_idx on attachments (increment_id);

alter table increments   enable row level security;
alter table attachments  enable row level security;
alter table milestones   enable row level security;
alter table revisions    enable row level security;
