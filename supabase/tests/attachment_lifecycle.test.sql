-- Slice 16, database half: an Attachment's path, and its deletion.
--
-- The object-level boundary is proved in storage_attachments.test.sql and the HTTP half
-- in supabase/tests/integration/storage_urls.test.ts (§16.5). This file covers the two
-- ends of an Attachment's life that are the database's own: §16.1, §16.2 and §16.6.

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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

create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $$
  select t.id from tiles t join boards b on b.id = t.board_id
   where b.member_id = member_of(name) and t.position = pos
$$;

create or replace function year_of(family text) returns uuid
language sql stable as $$
  select y.id from years y join families f on f.id = y.family_id where f.name = family
$$;

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

create or replace function objects_in_bucket() returns int
language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects o where o.bucket_id = 'attachments'
$$;

-- Objects whose bytes are owed a removal (§16.6). Postgres cannot delete a storage row —
-- storage.protect_delete() refuses everyone — so what the database owes is the intent,
-- recorded in the same commit as the Attachment going away.
create or replace function owed_reaping() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from orphaned_objects o where o.reaped_at is null
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Hertzell Family', 'America/New_York');
select open_year(family_named('Hertzell Family'), 2027);
select write_goal(tile_of('Alice', 0), 'Walk the dog', 100, 'walks');

select act_as('00000000-0000-4000-8000-0000000000a2');
select create_family('Okonkwo Family', 'Europe/London');
select open_year(family_named('Okonkwo Family'), 2027);
select write_goal(tile_of('Bob', 0), 'Swim', 50, 'swims');

select set_config('role', 'postgres', true);
update years set setup_deadline = now() - interval '1 minute';
update votes set closes_at = now() - interval '1 minute';

select act_as_cron();

-- ---------------------------------------------------------------------------------
-- The squares are dealt at seal (§4.1), so from here a Tile is found by its Goal
-- ---------------------------------------------------------------------------------
--
-- `positions are dealt at seal, so no Member can place the easy one in a corner`. Every
-- assertion below means "the Tile carrying the Goal I wrote to that square", never "square
-- N" — so that is what tile_of() now answers. Squares nothing was written to, including
-- the Centre at 12, still resolve literally: that is what the empty-Tile assertions of
-- §10.2 are about.
create or replace function tile_of(name text, pos int) returns uuid
language sql stable as $dealt$
  select coalesce(
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
       join goals  g on g.id = t.goal_id
      where b.member_id = member_of(name)
        and g.text = (select m.txt from (values
                ('Alice', 0, 'Walk the dog'),
                ('Bob', 0, 'Swim')
              ) as m(nm, ps, txt)
             where m.nm = name and m.ps = pos)),
    (select t.id
       from tiles t
       join boards b on b.id = t.board_id
      where b.member_id = member_of(name) and t.position = pos)
  )
$dealt$;

select is(seal_due_boards(), 2, 'both Families seal');

select act_as('00000000-0000-4000-8000-0000000000a1');
insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c1', tile_of('Alice', 0), member_of('Alice'));

-- ---------------------------------------------------------------------------------
-- §16.2 — the path is a function of the Increment
-- ---------------------------------------------------------------------------------

select lives_ok(
  format($$insert into attachments (increment_id, storage_path)
           values ('00000000-0000-4000-8000-0000000000c1', %L)$$,
         family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.jpg'),
  'a photo hangs off the Increment at its own path');

select is(
  (select a.storage_path from attachments a
    where a.increment_id = '00000000-0000-4000-8000-0000000000c1'),
  family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.jpg',
  '{family_id}/{increment_id}, the layout the bucket was created with');

-- §16.1: one, and only one.
select throws_ok(
  format($$insert into attachments (increment_id, storage_path)
           values ('00000000-0000-4000-8000-0000000000c1', %L)$$,
         family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.png'),
  '23505', null, 'one optional Attachment per Increment, and no more (§16.1)');

-- The hole this slice closes. `attachments_own_insert` checks the Increment is yours; it
-- never checked what the row pointed AT. Storage RLS would still refuse Alice the bytes,
-- but the path would have been handed to her client through the Feed to sign — a
-- boundary that holds only because the second lock held is not one to rely on.
select set_config('role', 'postgres', true);
delete from attachments;
-- That delete enqueued a reaping of its own, which is the subject of the next section
-- rather than this one.
delete from orphaned_objects;
select act_as('00000000-0000-4000-8000-0000000000a1');

select throws_ok(
  format($$insert into attachments (increment_id, storage_path)
           values ('00000000-0000-4000-8000-0000000000c1', %L)$$,
         family_named('Okonkwo Family') || '/00000000-0000-4000-8000-0000000000c1.jpg'),
  '42501', null,
  'CROSS-FAMILY: an Attachment cannot point at another Family''s folder');

select throws_ok(
  format($$insert into attachments (increment_id, storage_path)
           values ('00000000-0000-4000-8000-0000000000c1', %L)$$,
         family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000cf.jpg'),
  '42501', null,
  'nor at another Increment, even inside its own Family');

select throws_ok($$
  insert into attachments (increment_id, storage_path)
  values ('00000000-0000-4000-8000-0000000000c1', 'photos/anywhere-i-like.jpg')
$$, '42501', null, 'nor anywhere else in the bucket');

-- ---------------------------------------------------------------------------------
-- §16.6 — deleting an Increment deletes the photo, not just the row
-- ---------------------------------------------------------------------------------
--
-- Orphaned images of children sitting in a bucket after a Member believes they deleted
-- them is the worst version of this feature (ADR-0005).

select act_as('00000000-0000-4000-8000-0000000000a1');
insert into attachments (increment_id, storage_path)
  values ('00000000-0000-4000-8000-0000000000c1',
          family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.jpg');

insert into storage.objects (bucket_id, name, owner)
  values ('attachments',
          family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.jpg',
          '00000000-0000-4000-8000-0000000000a1');

select act_as_cron();
select is(objects_in_bucket(), 1, 'the object is in the bucket');
select is(owed_reaping(), 0, 'and nothing is owed a removal yet');

-- §11.3: deleting an Increment is the one mutation permitted, and it is how a Member
-- corrects a mistake. It has to take the photo with it.
select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$
  delete from increments where id = '00000000-0000-4000-8000-0000000000c1'
$$, 'the Member deletes the Increment (§11.3)');

select act_as_cron();
select is((select count(*)::int from attachments), 0,
  'the Attachment row cascades away with it');
select is(owed_reaping(), 1,
  'and the object is enqueued for removal in the same commit (§16.6)');
select is(
  (select o.object_path from orphaned_objects o where o.reaped_at is null),
  family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c1.jpg',
  'by its full path, which the reaper hands to the Storage API');
select is(
  (select o.family_id from orphaned_objects o where o.reaped_at is null),
  family_named('Hertzell Family'),
  'carrying the Family, because the Attachment it came from no longer exists to join to');

-- ---------------------------------------------------------------------------------
-- The same, one level up: deleting the Attachment alone
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c2', tile_of('Alice', 0), member_of('Alice'));
insert into attachments (increment_id, storage_path)
  values ('00000000-0000-4000-8000-0000000000c2',
          family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c2.jpg');
insert into storage.objects (bucket_id, name, owner)
  values ('attachments',
          family_named('Hertzell Family') || '/00000000-0000-4000-8000-0000000000c2.jpg',
          '00000000-0000-4000-8000-0000000000a1');

select act_as_cron();
select is(objects_in_bucket(), 2, 'a second photo is uploaded');
delete from orphaned_objects;

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$
  delete from attachments where increment_id = '00000000-0000-4000-8000-0000000000c2'
$$, 'the Member removes just the photo, keeping the Increment');

select act_as_cron();
select is(owed_reaping(), 1, 'the object is owed a removal on this path too');
select is((select count(*)::int from increments
            where id = '00000000-0000-4000-8000-0000000000c2'), 1,
  'and the Increment stands — a photo is optional, never the evidence (ADR-0005)');

-- The queue is the service role's alone. A list of recently deleted photo paths is not
-- something a client has any business reading.
select act_as('00000000-0000-4000-8000-0000000000a1');
select throws_ok($$select count(*) from orphaned_objects$$, '42501', null,
  'and no client can read what was deleted');

select * from finish();
rollback;
