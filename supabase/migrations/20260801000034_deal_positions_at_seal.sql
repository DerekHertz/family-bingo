-- ---------------------------------------------------------------------------------
-- Every Board is born with its layout already decided (FRONTEND_DESIGN §4.1)
-- ---------------------------------------------------------------------------------
--
--   > **Order is not priority.** The list stays in the order written; positions are
--   > dealt at seal, so no Member can place the easy one in a corner.
--
-- The second half of that sentence was never built. `write_goal()` writes to whichever
-- Tile is open, and the drafting table's "Write another" fills the lowest empty position,
-- so a Board came out in **exactly write order** — first Goal top-left, twenty-fourth
-- bottom-right.
--
-- That is not merely untidy. §13.1 pays out on Lines, and a Member who noticed the
-- mapping could write their three easiest Goals first, second and third and own the top
-- row before January. The whole point of the promise is that the board's shape is
-- something nobody chooses, and an unenforced promise is worse than none: the document
-- says a Member cannot stack a diagonal, so nobody thinks to check whether they can.
--
-- **The shuffle is a property of the Board, not an event that happens to it.**
--
-- The first version of this called `random()` at seal. It worked, and it was wrong in a
-- way worth recording: a Board's layout became a fact that existed nowhere until the
-- moment it was created, could not be predicted, reproduced, or explained afterwards, and
-- made every test that had ever written a Goal to a square nondeterministic. Three suites
-- went intermittently red and stayed that way.
--
-- So the permutation is *derived* from the Board's own id instead. A Board knows where its
-- first Goal will land from the moment `open_year()` deals it — nobody has to run
-- anything, nothing is stored, and asking twice always gives the same answer. It is still
-- unguessable in the only sense that matters: to aim a Goal at a square a Member would
-- need the Board's UUID before the Board exists, and then would have to be allowed to
-- choose which slot to write into, which §4.1 never offers them.

-- The 24 authorable squares, in the order this Board deals them.
--
-- `md5(board || position)` is a stable, well-spread sort key: every Board gets a different
-- ordering, the same Board always gets its own, and nothing about it is sequential, so
-- consecutive Goals do not walk a row or a diagonal the way an arithmetic permutation
-- (`(a*n + b) mod 24`) would. Position 12 is not in here at all — the Centre is a
-- position, not a Goal (§9.4, §13.1, and `family_goal_is_center_only`).
create or replace function board_positions(target_board_id uuid)
returns int[]
language sql
immutable
set search_path = public
as $$
  select array_agg(p order by md5(target_board_id::text || ':' || p::text))
    from generate_series(0, 24) as p
   where p <> 12;
$$;

comment on function board_positions(uuid) is
  'FRONTEND_DESIGN §4.1 — the 24 authorable squares in the order this Board deals them, '
  'derived from the Board''s own id so the layout is reproducible and explainable rather '
  'than a one-time roll of random(). Position 12 is excluded: the Centre is a position, '
  'not a Goal.';

-- Where the Goal written to `original_position` ends up.
--
-- Write order and position are the same thing while a Board is a draft, because "Write
-- another" fills the lowest empty square — so the n-th Goal written is the n-th authorable
-- position, and this is the map from that to where it is dealt.
create or replace function dealt_position(target_board_id uuid, original_position int)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when original_position = 12 then 12
    else (board_positions(target_board_id))[
           (select count(*)::int from generate_series(0, 24) as p
             where p <> 12 and p <= original_position)]
  end;
$$;

comment on function dealt_position(uuid, int) is
  'Where the Goal written to a given square ends up once the Board seals (§4.1). The '
  'inverse is board_positions(); both are pure functions of the Board id, which is what '
  'makes a dealt Board reproducible.';

-- ---------------------------------------------------------------------------------

create or replace function deal_positions(target_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- **The Goals move between Tiles; the Tiles do not move.**
  --
  -- Shuffling `tiles.position` cannot be done here. The permutation collides with
  -- `one_tile_per_position` at every intermediate row, and both usual ways out are
  -- closed: `tile_position_range` (0..24) leaves no spare values to park rows in, and
  -- making the constraint DEFERRABLE breaks `open_year()`, because
  -- `ON CONFLICT (board_id, position)` cannot infer a deferrable unique index. That one
  -- is not theoretical — it was tried, and it took out fourteen test files.
  --
  -- Permuting `goal_id` reaches the identical end state with no constraint touched, and
  -- it is only safe because of *when* this runs. At seal a Tile is an otherwise-empty
  -- shell: §11.5 refuses an Increment before `sealed_at`, so there are none to come
  -- loose, and Milestones and Revisions do not exist yet either. **This would not be safe
  -- one moment later**, which is why it belongs inside the seal and nowhere else.
  with authored as (
    select t.goal_id,
           row_number() over (order by t.position) as n
      from tiles t
     where t.board_id = target_board_id
       and t.position <> 12
  ),
  dealt as (
    -- The n-th authorable square, in the Board's own deal order.
    select p.position, p.n
      from unnest(board_positions(target_board_id)) with ordinality as p(position, n)
  )
  update tiles t
     set goal_id = authored.goal_id
    from dealt
    join authored on authored.n = dealt.n
   where t.board_id = target_board_id
     and t.position = dealt.position;
end;
$$;

comment on function deal_positions(uuid) is
  'FRONTEND_DESIGN §4.1 — lay a Board''s 24 authorable Goals out in the order '
  'board_positions() gives, so no Member can place the easy one in a corner. Permutes '
  '`goal_id` between Tiles rather than moving `tiles.position`, which would collide with '
  'one_tile_per_position and cannot be deferred without breaking open_year()''s '
  'ON CONFLICT. Safe only at seal, when no Increment, Milestone or Revision yet points at '
  'any of these Tiles (§11.5).';

-- ---------------------------------------------------------------------------------
-- Both seal paths deal, because there are two and only one of them is obvious
-- ---------------------------------------------------------------------------------

create or replace function seal_year(year_id uuid)
returns years
language plpgsql
security definer
set search_path = public
as $$
declare
  yr    years;
  b_id  uuid;
begin
  select * into yr from years where id = seal_year.year_id;
  if yr.id is null then
    raise exception 'no such Year' using errcode = '42501';
  end if;

  perform assert_cron_or_organizer(yr.family_id, 'seal a Year');

  -- §10.4. Checked before the deadline guard below, so re-running is always harmless
  -- while sealing early never is. It is also what keeps the deal a one-time event: a
  -- second call returns here, before anything is laid out again.
  if yr.sealed_at is not null then
    return yr;
  end if;

  -- Sealing is what the deadline is FOR. An Organizer who could seal early would be
  -- taking authoring time away from everyone else in the Family, silently, with no
  -- appeal — so the date decides, for them as much as for anyone.
  if now() < yr.setup_deadline then
    raise exception 'the Setup Window is still open' using errcode = 'PT403';
  end if;

  perform resolve_center_vote(yr.id);

  -- Deal only the Boards this call is about to seal, and deal them before they seal.
  -- Same transaction either way, but the order says what is true: a Board's squares are
  -- laid out as it seals, and a Board that was already sealed is never laid out again.
  for b_id in
    select b.id from boards b where b.year_id = yr.id and b.sealed_at is null
  loop
    perform deal_positions(b_id);
  end loop;

  -- §10.2: whether or not authoring finished. An empty Tile is a Tile whose Goal has
  -- not been written yet, and slice 18 is how it gets written.
  --
  -- Every Board in the Year, with no exception for `personal_setup_deadline` (§21.1): a
  -- late joiner is approved into a Year that is already active, and this only ever runs
  -- on a Year still in 'setup'. The sweep below is what seals those Boards.
  update boards b
     set sealed_at = now()
   where b.year_id = yr.id
     and b.sealed_at is null;

  update years
     set status = 'active', sealed_at = now()
   where id = yr.id
  returning * into yr;

  return yr;
end;
$$;

create or replace function seal_due_boards()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  due            years;
  sealed         int := 0;
  this_year      int;
  straggler_ids  uuid[];
  b_id           uuid;
begin
  for due in
    select * from years
     where status = 'setup' and now() >= setup_deadline
     order by setup_deadline
  loop
    begin
      perform seal_year(due.id);
      -- The loop only ever sees a Year in 'setup', which has never been sealed, so
      -- every sealed Board it now has was sealed by the call above.
      select count(*) into this_year from boards b
       where b.year_id = due.id and b.sealed_at is not null;
      sealed := sealed + this_year;
    exception when others then
      raise warning 'seal_year(%) failed: %', due.id, sqlerrm;
    end;
  end loop;

  -- §21.1's late joiners, sealed one at a time as their own windows close. **These need
  -- dealing too**, and that is the half worth stating: `seal_year()` is the obvious seal
  -- path and this is the one that gets forgotten, which would have left exactly the
  -- Members who joined mid-Year holding a board in write order while everyone else's was
  -- laid out. Collected first so the ids survive the UPDATE.
  select array_agg(b.id) into straggler_ids
    from boards b
    join years y on y.id = b.year_id
   where y.sealed_at is not null
     and y.frozen_at is null
     and b.sealed_at is null
     and b.personal_setup_deadline is not null
     and now() >= b.personal_setup_deadline;

  if straggler_ids is null then
    return sealed;
  end if;

  foreach b_id in array straggler_ids loop
    perform deal_positions(b_id);
  end loop;

  update boards set sealed_at = now() where id = any(straggler_ids);

  return sealed + array_length(straggler_ids, 1);
end;
$$;
