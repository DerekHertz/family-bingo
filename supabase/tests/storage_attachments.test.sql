-- Attachment Storage — the single highest-consequence test in the suite (PRD §16.5).
--
-- Everything else in this app leaking is embarrassing; this leaking is not. The payload
-- is photographs of children (ADR-0005).
--
-- This file proves the object-level boundary in the database. It does NOT prove the
-- HTTP half: that a direct object URL fails unauthenticated and cross-Family against a
-- real Storage endpoint still needs an integration test, because a signed URL is minted
-- by the Storage API rather than by a policy.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2');
insert into accounts (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2');

insert into families (id, name) values
  ('00000000-0000-4000-8000-0000000000f1', 'Hertzell Family'),
  ('00000000-0000-4000-8000-0000000000f2', 'Okonkwo Family');

insert into members (id, family_id, account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a1', 'Alice', 'organizer', 'active'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000f2',
   '00000000-0000-4000-8000-0000000000a2', 'Bob', 'organizer', 'active');

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- The bucket must be private. A public bucket makes every policy below decorative.
select is((select public from storage.buckets where id = 'attachments'), false,
  'the attachments bucket is PRIVATE — no public bucket, ever, not even in development');

-- ---------------------------------------------------------------------------------
-- Alice uploads a photo of her child under her Family's path segment.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

select lives_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('attachments',
          '00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000c1.jpg',
          '00000000-0000-4000-8000-0000000000a1')
$$, 'alice may upload under her own Family path segment');

select is((select count(*) from storage.objects where bucket_id = 'attachments')::int, 1,
  'alice can see her Family''s object');

-- She cannot plant an object in another Family's folder, which would otherwise be a way
-- to get a readable path inside their boundary.
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('attachments',
          '00000000-0000-4000-8000-0000000000f2/00000000-0000-4000-8000-0000000000c2.jpg',
          '00000000-0000-4000-8000-0000000000a1')
$$, '42501', null, 'alice cannot write into another Family''s folder');

-- ---------------------------------------------------------------------------------
-- Bob, in a different Family, gets ZERO ROWS — even knowing the exact object name.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');

select is((select count(*) from storage.objects where bucket_id = 'attachments')::int, 0,
  'CROSS-FAMILY: bob gets zero rows from storage.objects');

select is((select count(*) from storage.objects
            where name = '00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000c1.jpg')::int,
  0, 'CROSS-FAMILY: knowing the exact object path does not help bob');

select is((select count(*) from storage.objects
            where bucket_id = 'attachments'
              and name like '00000000-0000-4000-8000-0000000000f1/%')::int,
  0, 'CROSS-FAMILY: bob cannot enumerate another Family''s folder');

-- ---------------------------------------------------------------------------------
-- An unauthenticated caller gets zero rows.
-- ---------------------------------------------------------------------------------

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);

select is((select count(*) from storage.objects where bucket_id = 'attachments')::int, 0,
  'ANON: zero rows from storage.objects');

-- A malformed first path segment must return NULL rather than raise: a policy that
-- throws on a bad object name is an error oracle, and the error aborts the statement.
select is(safe_uuid('not-a-uuid'), null,
  'a non-uuid path segment resolves to NULL instead of raising');

select * from finish();
rollback;
