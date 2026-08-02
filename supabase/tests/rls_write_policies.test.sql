-- Negative tests for the WRITE side of the boundary.
--
-- rls_family_boundary.test.sql proves that another Family reads zero rows. This file
-- proves the other half of schema.md §4.2: reads are Family-wide, but WRITES are
-- self-only, and the Organizer's powers are the Organizer's alone.
--
-- The subject here is mostly an ACTIVE Member of the SAME Family — the caller a
-- Family-scoped read policy happily lets through. Every assertion below is about what
-- that Member still may not do.
--
-- Note the two shapes of refusal. An INSERT that fails WITH CHECK raises 42501; an
-- UPDATE or DELETE whose USING clause matches no row simply affects nothing. Both are
-- correct, and neither tells the caller whether the row exists (api.md §9).

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'),  -- alice, Organizer of Family 1
  ('00000000-0000-4000-8000-0000000000a2'),  -- bob, Organizer of Family 2
  ('00000000-0000-4000-8000-0000000000a3'),  -- carol, pending in Family 1
  ('00000000-0000-4000-8000-0000000000a4');  -- dave, an ordinary Member of Family 1
-- accounts rows are provisioned by the on_auth_user_created trigger (slice 1).

insert into families (id, name) values
  ('00000000-0000-4000-8000-0000000000f1', 'Hertzell Family'),
  ('00000000-0000-4000-8000-0000000000f2', 'Okonkwo Family');

insert into members (id, family_id, account_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a1', 'Alice', 'organizer', 'active'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000f2',
   '00000000-0000-4000-8000-0000000000a2', 'Bob', 'organizer', 'active'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a3', 'Carol', 'member', 'pending'),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-0000000000a4', 'Dave', 'member', 'active');

insert into invitations (id, family_id, token_hash, created_by_member_id, expires_at) values
  ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000f1',
   'hash-for-carol', '00000000-0000-4000-8000-0000000000e1', now() + interval '7 days');

insert into years (id, family_id, calendar_year, setup_deadline) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
   2027, '2027-01-01T05:00:00Z');
insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-0000000000d1', '2027-01-01T05:00:00Z');
insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b1', p from generate_series(0, 24) p;
insert into increments (id, tile_id, member_id) values
  ('00000000-0000-4000-8000-0000000000c1',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b1' and position = 0),
   '00000000-0000-4000-8000-0000000000e1');
insert into votes (id, year_id, kind, closes_at) values
  ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000d1',
   'mode', '2027-01-01T05:00:00Z');

-- Dave's own Boards, for the §11.5 timing tests: one still in its Setup Window, and one
-- in a Year that has already frozen.
insert into boards (id, member_id, year_id) values
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000e5',
   '00000000-0000-4000-8000-0000000000d1');
insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b5', p from generate_series(0, 24) p;

insert into years (id, family_id, calendar_year, status, setup_deadline, sealed_at, frozen_at) values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000f1',
   2026, 'frozen', '2026-01-01T05:00:00Z', '2026-01-01T05:00:00Z', '2027-01-01T05:00:00Z');
insert into boards (id, member_id, year_id, sealed_at) values
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000e5',
   '00000000-0000-4000-8000-0000000000d2', '2026-01-01T05:00:00Z');
insert into tiles (board_id, position)
  select '00000000-0000-4000-8000-0000000000b6', p from generate_series(0, 24) p;
insert into increments (id, tile_id, member_id) values
  ('00000000-0000-4000-8000-0000000000c7',
   (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b6' and position = 0),
   '00000000-0000-4000-8000-0000000000e5');
insert into device_tokens (id, account_id, token, platform) values
  ('00000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-0000000000a1',
   'ExponentPushToken[alice]', 'ios');

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Dave is an active Member of Family 1, but not the Organizer. He can SEE everything
-- his Family does — and administer none of it.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a4');

select is((select count(*) from members)::int, 3,
  'dave reads his whole Family, as a Member should');

select is((select count(*) from invitations)::int, 0,
  'NON-ORGANIZER: dave cannot read Invitations — a live token is the Organizer''s alone');

select throws_ok($$
  insert into invitations (family_id, token_hash, created_by_member_id, expires_at)
  values ('00000000-0000-4000-8000-0000000000f1', 'dave-made-this',
          '00000000-0000-4000-8000-0000000000e5', now() + interval '7 days')
$$, '42501', null, 'NON-ORGANIZER: dave cannot mint an Invitation');

-- Approval is the second of the two gates that stop a forwarded link (PRD §3.5).
update members set status = 'active' where id = '00000000-0000-4000-8000-0000000000e4';
select is((select status from members where id = '00000000-0000-4000-8000-0000000000e4'),
  'pending', 'NON-ORGANIZER: dave cannot approve a pending Member');

-- ESCALATION: dave controls his own Member row, so members_self_update lets the UPDATE
-- through at the row level. Only the column-scoped GRANT stops him rewriting the two
-- columns that matter. Both of these must be a hard 42501, not a silent no-op.
select throws_ok($$
  update members set role = 'organizer' where id = '00000000-0000-4000-8000-0000000000e5'
$$, '42501', null,
  'ESCALATION: dave cannot promote himself to Organizer on his own row');

select throws_ok($$
  update members set family_id = '00000000-0000-4000-8000-0000000000f2'
   where id = '00000000-0000-4000-8000-0000000000e5'
$$, '42501', null,
  'ESCALATION: dave cannot move his own Member into another Family — §8.1, the whole point');

select throws_ok($$
  update members set account_id = '00000000-0000-4000-8000-0000000000a2'
   where id = '00000000-0000-4000-8000-0000000000e5'
$$, '42501', null,
  'ESCALATION: dave cannot re-point his Member at another Account');

delete from members where id = '00000000-0000-4000-8000-0000000000e1';
select is((select count(*) from members where id = '00000000-0000-4000-8000-0000000000e1')::int,
  1, 'NON-ORGANIZER: dave cannot remove another Member');

update families set name = 'Dave Family' where id = '00000000-0000-4000-8000-0000000000f1';
select is((select name from families where id = '00000000-0000-4000-8000-0000000000f1'),
  'Hertzell Family', 'NON-ORGANIZER: dave cannot rename the Family');

update members set display_name = 'Renamed'
 where id = '00000000-0000-4000-8000-0000000000e1';
select is((select display_name from members where id = '00000000-0000-4000-8000-0000000000e1'),
  'Alice', 'SELF-ONLY: dave cannot rename another Member');

update members set display_name = 'Dave the Great'
 where id = '00000000-0000-4000-8000-0000000000e5';
select is((select display_name from members where id = '00000000-0000-4000-8000-0000000000e5'),
  'Dave the Great', 'SELF-ONLY: dave can rename himself');

-- The Feed is Family-wide to read and self-only to write.
delete from increments where id = '00000000-0000-4000-8000-0000000000c1';
select is((select count(*) from increments where id = '00000000-0000-4000-8000-0000000000c1')::int,
  1, 'SELF-ONLY: dave cannot delete alice''s Increment');

select throws_ok($$
  insert into attachments (increment_id, storage_path)
  values ('00000000-0000-4000-8000-0000000000c1', 'x/y.jpg')
$$, '42501', null, 'SELF-ONLY: dave cannot hang a photo on alice''s Increment');

select throws_ok($$
  insert into ballots (vote_id, member_id, choice_mode)
  values ('00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'shared')
$$, '42501', null, 'SELF-ONLY: dave cannot cast a Ballot as alice');

select throws_ok($$
  insert into proposals (vote_id, member_id, text)
  values ('00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'Dave''s idea, alice''s name')
$$, '42501', null, 'SELF-ONLY: dave cannot submit a Proposal as alice');

select lives_ok($$
  insert into ballots (vote_id, member_id, choice_mode)
  values ('00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e5', 'personal')
$$, 'SELF-ONLY: dave can cast his own Ballot');

select is((select count(*) from device_tokens)::int, 0,
  'SELF-ONLY: dave cannot read alice''s device tokens');

-- §11.5: an Increment cannot be logged before the Board seals or after the Year freezes.
-- Both of these are Tiles on dave's OWN Board — ownership is not the thing being tested.
select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c5',
          (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b5' and position = 0),
          '00000000-0000-4000-8000-0000000000e5')
$$, '42501', null,
  'NO BACKDATING: dave cannot log against an unsealed Board (§11.5)');

select throws_ok($$
  insert into increments (id, tile_id, member_id)
  values ('00000000-0000-4000-8000-0000000000c6',
          (select id from tiles where board_id = '00000000-0000-4000-8000-0000000000b6' and position = 0),
          '00000000-0000-4000-8000-0000000000e5')
$$, '42501', null,
  'NO BACKDATING: dave cannot log into a frozen Year (§11.5, §20.1)');

delete from increments where id = '00000000-0000-4000-8000-0000000000c7';
select is((select count(*) from increments where id = '00000000-0000-4000-8000-0000000000c7')::int,
  1, 'FROZEN: a frozen Year is read-only — even deleting is refused (§20.1)');

update accounts set email = 'dave@evil.test' where id = '00000000-0000-4000-8000-0000000000a1';
select is((select count(*) from accounts where email = 'dave@evil.test')::int, 0,
  'SELF-ONLY: dave cannot edit another Account');

-- Milestones and Revisions are written by the server, never by a client: a Bingo is a
-- social claim and must not be forgeable, and a Revision is what makes it checkable.
select throws_ok($$
  insert into milestones (member_id, year_id, type, line_index)
  values ('00000000-0000-4000-8000-0000000000e5',
          '00000000-0000-4000-8000-0000000000d1', 'bingo', 0)
$$, '42501', null, 'NOBODY: a Member cannot forge their own Bingo');

select throws_ok($$
  insert into revisions (board_id, tile_id, after_text, after_target)
  values ('00000000-0000-4000-8000-0000000000b1',
          (select id from tiles limit 1), 'Sneaky', 1)
$$, '42501', null, 'NOBODY: a Member cannot write a Revision directly, bypassing the budget');

-- ---------------------------------------------------------------------------------
-- Alice, the Organizer, can do the things Dave could not.
-- ---------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------
-- Bob is in Family 2 and controls a Member — just not one entitled to this Vote.
-- Checking only `member_id in controlled_member_ids()` would let this through, and
-- resolve_vote() would then count a stranger's Ballot.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');

select throws_ok($$
  insert into ballots (vote_id, member_id, choice_mode)
  values ('00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e3', 'shared')
$$, '42501', null,
  'CROSS-FAMILY: bob cannot cast his own Ballot into another Family''s Vote');

select throws_ok($$
  insert into proposals (vote_id, member_id, text)
  values ('00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e3', 'A stranger''s idea')
$$, '42501', null,
  'CROSS-FAMILY: bob cannot put a Proposal into another Family''s Vote');

-- ---------------------------------------------------------------------------------
-- Alice, the Organizer, can do the things Dave could not.
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a1');

select is((select count(*) from invitations)::int, 1,
  'ORGANIZER: alice reads the Invitations she minted');

update members set status = 'active' where id = '00000000-0000-4000-8000-0000000000e4';
select is((select status from members where id = '00000000-0000-4000-8000-0000000000e4'),
  'active', 'ORGANIZER: alice can approve a pending Member');

select * from finish();
rollback;
