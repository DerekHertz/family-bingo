-- Dealing the Goals into positions at seal (FRONTEND_DESIGN §4.1).
--
--   > Order is not priority. The list stays in the order written; positions are dealt at
--   > seal, so no Member can place the easy one in a corner.
--
-- The deal is random, so almost nothing here asserts *where* a Goal lands. What it
-- asserts is everything that must be true whatever the shuffle produced: the Board is
-- still a Board, the Centre is still the Centre, every Goal is still on its own Tile, and
-- nothing that points at a Tile came loose.

begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function act_as_cron() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function member_of(name text) returns uuid
language sql stable as $$ select id from members where display_name = name $$;

create or replace function board_of(name text) returns uuid
language sql stable as $$
  select b.id from boards b where b.member_id = member_of(name)
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'ada@example.test', '{"full_name":"Ada"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000c1');
select create_family('Deal Family', 'UTC');
select create_managed_member((select id from families where name = 'Deal Family'), 'Kit');

select set_config('role', 'postgres', true);

-- A Year whose Setup Window has already closed, so seal_year() will take it.
insert into years (family_id, calendar_year, status, center_mode, setup_deadline)
select f.id, 2029, 'setup', 'personal', now() - interval '1 day'
  from families f where f.name = 'Deal Family';

-- Boards and their 25 Tiles, exactly as open_year() deals them.
insert into boards (year_id, member_id)
select y.id, m.id
  from years y
  join members m on m.family_id = y.family_id
 where y.calendar_year = 2029;

insert into tiles (board_id, position)
select b.id, p
  from boards b
  join years y on y.id = b.year_id
  cross join generate_series(0, 24) as p
 where y.calendar_year = 2029;

-- Write all 24 authorable Goals on Ada's Board, in position order — which is what the
-- drafting table's "Write another" actually produces, and therefore the arrangement this
-- whole feature exists to break up. The Goal text records where it started.
do $$
declare p int;
begin
  for p in 0..24 loop
    if p <> 12 then
      insert into goals (text, target) values ('goal at ' || p, 3);
      update tiles set goal_id = (select id from goals where text = 'goal at ' || p)
       where board_id = board_of('Ada') and position = p;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------
-- Before: write order, exactly
-- ---------------------------------------------------------------------------------

select is(
  (select count(*)::int from tiles t join goals g on g.id = t.goal_id
    where t.board_id = board_of('Ada') and g.text = 'goal at ' || t.position),
  24,
  'before the deal, every Goal sits at the position it was written to'
);

-- ---------------------------------------------------------------------------------
-- Seal
-- ---------------------------------------------------------------------------------

select act_as_cron();
select lives_ok(
  $$ select seal_year((select id from years where calendar_year = 2029)) $$,
  'seal_year() runs with the deal in it'
);
select set_config('role', 'postgres', true);

-- ---------------------------------------------------------------------------------
-- The Board is still a Board
-- ---------------------------------------------------------------------------------

select is(
  (select count(*)::int from tiles where board_id = board_of('Ada')),
  25,
  'Ada still has 25 Tiles'
);

select is(
  (select count(distinct position)::int from tiles where board_id = board_of('Ada')),
  25,
  'every position is still distinct — the deal is a permutation, not a scatter'
);

select is(
  (select array_agg(position order by position) from tiles where board_id = board_of('Ada')),
  (select array_agg(p order by p) from generate_series(0, 24) as p),
  'and it is still exactly 0..24, with none invented and none lost'
);

-- The Tiles themselves never move — it is the Goals that are dealt. Moving `position`
-- would collide with one_tile_per_position, and deferring that constraint breaks
-- open_year()'s ON CONFLICT.
select is(
  (select count(*)::int from tiles where board_id = board_of('Ada')
    and position not between 0 and 24),
  0,
  'every Tile is still at a legal position'
);

select is(
  (select count(*)::int from tiles where board_id = board_of('Kit')),
  25,
  'Kit''s untouched Board survives the deal too (§10.2 — it has no Goals at all)'
);

select is(
  (select count(distinct position)::int from tiles where board_id = board_of('Kit')),
  25,
  'and its positions are still distinct'
);

-- ---------------------------------------------------------------------------------
-- The Centre is a position, not a Goal
-- ---------------------------------------------------------------------------------

select is(
  (select goal_id from tiles where board_id = board_of('Ada') and position = 12),
  null,
  'position 12 is still the Centre and still holds no personal Goal'
);

select is(
  (select count(*)::int from tiles t join goals g on g.id = t.goal_id
    where t.board_id = board_of('Ada') and g.text = 'goal at 12'),
  0,
  'nothing was ever written to 12, and the deal did not move something into it'
);

-- ---------------------------------------------------------------------------------
-- Every Goal is still on a Tile, and still exactly one
-- ---------------------------------------------------------------------------------

select is(
  (select count(*)::int from tiles where board_id = board_of('Ada') and goal_id is not null),
  24,
  'all 24 Goals are still attached'
);

select is(
  (select count(distinct goal_id)::int from tiles
    where board_id = board_of('Ada') and goal_id is not null),
  24,
  'and no Goal was duplicated onto two Tiles'
);

select is(
  (select count(*)::int from goals g
    where g.text like 'goal at %'
      and not exists (select 1 from tiles t where t.goal_id = g.id)),
  0,
  'no Goal was orphaned — every one of them is still reachable through a Tile'
);

-- ---------------------------------------------------------------------------------
-- The point of the whole exercise
-- ---------------------------------------------------------------------------------

-- 24 Goals landing back on their own positions has probability 1/24!, which is about
-- 1 in 6.2e23. If this ever fails, the deal did not run.
select cmp_ok(
  (select count(*)::int from tiles t join goals g on g.id = t.goal_id
    where t.board_id = board_of('Ada') and g.text = 'goal at ' || t.position),
  '<', 24,
  'the Goals are no longer in write order — a Member cannot place the easy one in a corner'
);

-- ---------------------------------------------------------------------------------
-- §10.4 — sealing is idempotent, and the deal must not re-run
-- ---------------------------------------------------------------------------------

create temporary table dealt as
  select id, goal_id from tiles where board_id = board_of('Ada');

select act_as_cron();
select lives_ok(
  $$ select seal_year((select id from years where calendar_year = 2029)) $$,
  'seal_year() is still safe to re-run'
);
select set_config('role', 'postgres', true);

select is(
  (select count(*)::int from tiles t join dealt d on d.id = t.id
    where t.goal_id is distinct from d.goal_id),
  0,
  'a second seal reshuffles nothing — a sealed Board''s squares are fixed (§10.3)'
);

-- ---------------------------------------------------------------------------------
-- Nothing that points at a Tile came loose
-- ---------------------------------------------------------------------------------

-- Increments reference tile_id, never position, which is the reason the deal is safe.
insert into increments (id, tile_id, member_id)
select gen_random_uuid(), t.id, member_of('Ada')
  from tiles t
 where t.board_id = board_of('Ada') and t.goal_id is not null
 limit 2;

select is(
  (select count(*)::int from increments i join tiles t on t.id = i.tile_id
    where t.board_id = board_of('Ada')),
  2,
  'Increments logged after the deal sit on the Tile that now holds their Goal'
);

-- ---------------------------------------------------------------------------------
-- deal_positions() itself
-- ---------------------------------------------------------------------------------

select has_function('deal_positions', array['uuid'], 'deal_positions(uuid) exists');

select lives_ok(
  $$ select deal_positions(board_of('Kit')) $$,
  'dealing a Board with no Goals at all is fine (§10.2)'
);

select is(
  (select count(distinct position)::int from tiles where board_id = board_of('Kit')),
  25,
  'and it is still a well-formed Board afterwards'
);

select is(
  (select position from tiles t join goals g on g.id = t.goal_id
    where t.board_id = board_of('Ada') and g.text = 'goal at 0'
    limit 1) is not null,
  true,
  'a specific Goal is still findable — it simply lives somewhere else now'
);

-- The constraint is deliberately left alone. Making it deferrable — the obvious way to
-- permute `position` in one statement — breaks open_year(), because ON CONFLICT cannot
-- infer a deferrable unique index. Dealing the Goals instead needs no such change.
select is(
  (select condeferrable from pg_constraint where conname = 'one_tile_per_position'),
  false,
  'one_tile_per_position is still non-deferrable, so open_year()''s ON CONFLICT still works'
);

select throws_ok(
  $$ insert into tiles (board_id, position) values (board_of('Kit'), 5) $$,
  '23505',
  null,
  'and it still rejects a duplicate position immediately'
);

select * from finish();
rollback;
