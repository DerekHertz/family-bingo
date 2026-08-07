-- board_tile_counts() — progress for a whole Board, in one answer.
--
-- The client used to fetch every Increment row and count them in JavaScript, which could
-- not begin until the Tiles had arrived and silently truncated at PostgREST's
-- `max_rows = 1000`. What matters here is that moving the count into SQL changed neither
-- of the two things it is trusted for: the number, and who is allowed to see it.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function member_of(name text) returns uuid
language sql stable as $$ select id from members where display_name = name $$;

create or replace function board_of(name text) returns uuid
language sql stable as $$
  select b.id from boards b where b.member_id = member_of(name) limit 1
$$;

create or replace function tile_at(board uuid, pos int) returns uuid
language sql stable as $$
  select id from tiles where board_id = board and position = pos
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'ada@example.test',  '{"full_name":"Ada"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'boaz@example.test', '{"full_name":"Boaz"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a9', 'zia@example.test',  '{"full_name":"Zia"}'::jsonb);

-- One Family playing, and one stranger with a Family of her own — §8.1's P2 requires a
-- negative test on every read, and this is a read.
select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'UTC');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  ((select id from families where name = 'Hertzell Family'),
   '00000000-0000-4000-8000-0000000000a2', 'Boaz', 'member', 'active');

select act_as('00000000-0000-4000-8000-0000000000a9');
select create_family('Okonkwo Family', 'UTC');

select act_as('00000000-0000-4000-8000-0000000000a1');
select open_year((select id from families where name = 'Hertzell Family'), 2027);

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute',
                 play_opens_at  = now() - interval '1 minute'
 where family_id = (select id from families where name = 'Hertzell Family');
update votes set closes_at = now() - interval '1 minute'
 where year_id in (select id from years
                    where family_id = (select id from families where name = 'Hertzell Family'));

-- Goals on two of Ada's squares, so a dealt Board has something to count.
select act_as('00000000-0000-4000-8000-0000000000a1');
select write_goal(tile_at(board_of('Ada'), 0), 'Walk every day', 144, 'walks');
select write_goal(tile_at(board_of('Ada'), 1), 'Read more books', 12, 'books');

select set_config('role', 'postgres', true);
select seal_due_boards();

-- Three on one square, one on another, none on the rest.
select act_as('00000000-0000-4000-8000-0000000000a1');
insert into increments (id, tile_id, member_id)
select gen_random_uuid(), t.id, member_of('Ada')
  from tiles t, generate_series(1, 3)
 where t.board_id = board_of('Ada') and t.goal_id is not null
   and t.position = (select min(position) from tiles
                      where board_id = board_of('Ada') and goal_id is not null);

insert into increments (id, tile_id, member_id)
select gen_random_uuid(), t.id, member_of('Ada')
  from tiles t
 where t.board_id = board_of('Ada') and t.goal_id is not null
   and t.position = (select max(position) from tiles
                      where board_id = board_of('Ada') and goal_id is not null);

-- ---------------------------------------------------------------------------------
-- The number
-- ---------------------------------------------------------------------------------

select is((select count(*)::int from board_tile_counts(board_of('Ada'))), 2,
  'only Tiles carrying at least one Increment come back');

select is((select sum(n)::int from board_tile_counts(board_of('Ada'))), 4,
  'and they add up to every Increment on the Board');

select is(
  (select n from board_tile_counts(board_of('Ada')) c
    join tiles t on t.id = c.tile_id
   where t.position = (select min(position) from tiles
                        where board_id = board_of('Ada') and goal_id is not null)),
  3, 'counted per Tile rather than pooled');

-- A Tile with no Increments is absent rather than zero, which is what the client's
-- `counts[id] ?? 0` has always assumed.
select is(
  (select count(*)::int from board_tile_counts(board_of('Ada')) c
    join tiles t on t.id = c.tile_id
   where t.position = 12),
  0, 'an untouched Tile is simply not in the result');

-- It is a read of the log, not a stored counter (§11.4). Deleting has to move it.
select set_config('role', 'postgres', true);
delete from increments where id = (
  select i.id from increments i join tiles t on t.id = i.tile_id
   where t.board_id = board_of('Ada') limit 1);

select act_as('00000000-0000-4000-8000-0000000000a1');
select is((select sum(n)::int from board_tile_counts(board_of('Ada'))), 3,
  'deleting an Increment moves the count — there is no counter to drift (§11.4)');

-- ---------------------------------------------------------------------------------
-- Who may see it
-- ---------------------------------------------------------------------------------
--
-- The whole point of leaving this SECURITY INVOKER. If it were DEFINER, every assertion
-- below would pass a board id straight through RLS.

select is((select count(*)::int from board_tile_counts(board_of('Ada'))), 2,
  'the owner sees their own Board');

select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from board_tile_counts(board_of('Ada'))), 2,
  'and so does the rest of the Family — reads are Family-wide, which is §23''s whole basis');

select act_as('00000000-0000-4000-8000-0000000000a9');
select is((select count(*)::int from board_tile_counts(board_of('Ada'))), 0,
  'a stranger gets ZERO ROWS for a Board in a Family that is not theirs (§8.1 P2)');

select lives_ok(
  $$select * from board_tile_counts(board_of('Ada'))$$,
  'and gets them as an empty result rather than an error — a 403 confirms the Board exists');

select is((select count(*)::int from board_tile_counts(gen_random_uuid())), 0,
  'a Board id that names nothing is empty too, and says nothing about which');

-- ---------------------------------------------------------------------------------
-- Reachability
-- ---------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
select ok(
  has_function_privilege('authenticated', 'board_tile_counts(uuid)', 'execute'),
  'a signed-in Member may call it — it is the Board screen''s own read');

select ok(
  not has_function_privilege('anon', 'board_tile_counts(uuid)', 'execute'),
  'and a caller with no session may not, though RLS would answer nothing anyway');

select * from finish();
rollback;
