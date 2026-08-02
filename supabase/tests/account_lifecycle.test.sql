-- Slice 1, server half: an Account is provisioned automatically, and deleting it takes
-- everything it owns and everything it guards (PRD §1.5).
--
-- The deletion half is the part that matters. An account-deletion promise that leaves
-- a child's photographs in the database is worse than not offering one.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Provisioning
-- ---------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test');

select is((select count(*) from accounts where id = '00000000-0000-4000-8000-0000000000a1')::int,
  1, 'signing up provisions an Account row automatically');
select is((select email from accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  'alice@example.test', 'the Account carries the email for contact');

-- Apple private-relay addresses rotate. The row follows; nothing joins on it (§1.2).
update auth.users set email = 'relay-9f2c@privaterelay.appleid.com'
 where id = '00000000-0000-4000-8000-0000000000a1';
select is((select email from accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  'relay-9f2c@privaterelay.appleid.com',
  'a changed email updates the Account rather than creating a second one');
select is((select count(*) from accounts)::int, 1,
  'a rotating email never forks an Account — identity is the id alone (§1.2)');

-- ---------------------------------------------------------------------------------
-- A Family with a Guardian, a Managed Member, and a full Board underneath.
-- ---------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test');

insert into families (id, name) values
  ('00000000-0000-4000-8000-0000000000f1', 'Hertzell Family');

insert into members (id, family_id, account_id, guardian_account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a1', null, 'Alice', 'organizer', 'active'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000f1',
   null, '00000000-0000-4000-8000-0000000000a1', 'Theo', 'member', 'active'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a2', null, 'Bob', 'member', 'active');

insert into years (id, family_id, calendar_year, setup_deadline) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
   2027, '2027-01-01T05:00:00Z');

-- A Board for the Guardian, one for the child, one for an unrelated Member.
insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-0000000000d1', '2027-01-01T05:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000e2',
   '00000000-0000-4000-8000-0000000000d1', '2027-01-01T05:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000e3',
   '00000000-0000-4000-8000-0000000000d1', '2027-01-01T05:00:00Z');

insert into tiles (board_id, position)
  select b, p from unnest(array[
    '00000000-0000-4000-8000-0000000000b1'::uuid,
    '00000000-0000-4000-8000-0000000000b2'::uuid,
    '00000000-0000-4000-8000-0000000000b3'::uuid]) b,
    generate_series(0, 24) p;

-- One Goal on the child's Board, one on the unrelated Member's.
insert into goals (id, text, target) values
  ('00000000-0000-4000-8000-0000000000ba', 'Learn to swim', 10),
  ('00000000-0000-4000-8000-0000000000bb', 'Read more books', 12);
update tiles set goal_id = '00000000-0000-4000-8000-0000000000ba'
 where board_id = '00000000-0000-4000-8000-0000000000b2' and position = 0;
update tiles set goal_id = '00000000-0000-4000-8000-0000000000bb'
 where board_id = '00000000-0000-4000-8000-0000000000b3' and position = 0;

insert into increments (id, tile_id, member_id, note) values
  ('00000000-0000-4000-8000-0000000000c1',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b2' and position = 0),
   '00000000-0000-4000-8000-0000000000e2', 'first length unaided'),
  ('00000000-0000-4000-8000-0000000000c2',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b3' and position = 0),
   '00000000-0000-4000-8000-0000000000e3', null);

insert into attachments (increment_id, storage_path) values
  ('00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000c1.jpg');

insert into milestones (member_id, year_id, type, tile_id) values
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d1', 'tile_completed',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b2' and position = 0));

select is((select count(*) from members)::int, 3, 'the Family has three Members before deletion');
select is((select count(*) from goals)::int, 2, 'two Goals exist before deletion');

-- ---------------------------------------------------------------------------------
-- Alice deletes her Account.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');
select lives_ok('select delete_account()', 'a Member may delete their own Account (§1.5)');

select set_config('role', 'postgres', true);

select is((select count(*) from accounts where id = '00000000-0000-4000-8000-0000000000a1')::int,
  0, 'DELETION: the Account is gone');
select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-0000000000a1')::int,
  0, 'DELETION: the auth identity is gone — nothing to sign back in to');
select is((select count(*) from members where id = '00000000-0000-4000-8000-0000000000e1')::int,
  0, 'DELETION: the Member it owned is gone');
select is((select count(*) from members where id = '00000000-0000-4000-8000-0000000000e2')::int,
  0, 'DELETION: the Managed Member it guarded is gone (§1.5)');
select is((select count(*) from boards where id in
    ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2'))::int,
  0, 'DELETION: both Boards are gone');
select is((select count(*) from tiles where board_id in
    ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2'))::int,
  0, 'DELETION: their Tiles are gone');
select is((select count(*) from increments where id = '00000000-0000-4000-8000-0000000000c1')::int,
  0, 'DELETION: the child''s Increments are gone');
select is((select count(*) from attachments)::int, 0,
  'DELETION: the Attachment row is gone — a photograph of a child must not outlive consent');
select is((select count(*) from milestones)::int, 0, 'DELETION: their Milestones are gone');
select is((select count(*) from goals where id = '00000000-0000-4000-8000-0000000000ba')::int,
  0, 'DELETION: the child''s Goal is swept, not orphaned (§1.5)');

-- And nothing belonging to anyone else moved.
select is((select count(*) from members where id = '00000000-0000-4000-8000-0000000000e3')::int,
  1, 'UNTOUCHED: an unrelated Member survives');
select is((select count(*) from goals where id = '00000000-0000-4000-8000-0000000000bb')::int,
  1, 'UNTOUCHED: their Goal survives');
select is((select count(*) from increments where id = '00000000-0000-4000-8000-0000000000c2')::int,
  1, 'UNTOUCHED: their Increment survives');
select is((select count(*) from families)::int, 1,
  'UNTOUCHED: the Family itself survives its Organizer leaving');

select * from finish();
rollback;
