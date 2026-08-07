-- A Member approved during the Setup Window gets a Board (20260801000038).
--
-- The gap this closes was not a subtle one, and it survived 900 assertions because every
-- one of them approved a Member into a Year that was either not open yet or already
-- sealed. Nobody tested the window in between — which is the *most likely* moment for
-- somebody to arrive, since it is exactly when an Organizer invites the family.
--
-- The distinction this file exists to pin: an approval during setup produces an **ordinary**
-- Board, and an approval after the seal produces a **late joiner's** Board. Same trigger,
-- two different answers, and getting them the same way round is the whole point.

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

create or replace function act_as_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'organizer@setupwindow.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'insetup@setupwindow.test'),
  ('00000000-0000-4000-8000-0000000000b3', 'afterseal@setupwindow.test');

select act_as('00000000-0000-4000-8000-0000000000b1');
select id as family_id from create_family('Setup Window Family', 'UTC') \gset
select open_year(:'family_id', 2027);

-- ---------------------------------------------------------------------------------------
-- Approved while the Year is still open for writing
-- ---------------------------------------------------------------------------------------

select act_as_postgres();
insert into members (family_id, account_id, display_name, role, status)
  values (:'family_id', '00000000-0000-4000-8000-0000000000b2', 'Mid-setup', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$select approve_member((select id from members where display_name = 'Mid-setup'))$$,
  'the Organizer approves a Member while the Setup Window is open');

select act_as_postgres();

select is(
  (select count(*)::int from boards b
     join members m on m.id = b.member_id where m.display_name = 'Mid-setup'),
  1,
  'and they get a Board — which they did not, and which locked them out of the Year');

-- 25 Tiles, because a Board without them is one `write_goal` away from failing.
select is(
  (select count(*)::int from tiles t
     join boards b on b.id = t.board_id
     join members m on m.id = b.member_id where m.display_name = 'Mid-setup'),
  25,
  'with all 25 Tiles');

-- They are NOT a late joiner. They arrived while everyone was still writing, so they seal
-- on the Family's clock and §21.4's marker would be a lie about them.
select is(
  (select b.joined_late_at from boards b
     join members m on m.id = b.member_id where m.display_name = 'Mid-setup'),
  null,
  'and no "joined late" marker, because they did not');

select is(
  (select b.personal_setup_deadline from boards b
     join members m on m.id = b.member_id where m.display_name = 'Mid-setup'),
  null,
  'and no personal deadline — the Family''s own is the one that applies');

-- The Centre is not invented before the Family has chosen it.
select is(
  (select t.family_goal_id from tiles t
     join boards b on b.id = t.board_id
     join members m on m.id = b.member_id
    where m.display_name = 'Mid-setup' and t.position = 12),
  null,
  'and no Centre, because the vote has not resolved yet');

-- The write path actually works for them, which is the thing the bug denied.
select act_as('00000000-0000-4000-8000-0000000000b2');
select lives_ok(
  $$select write_goal(
      (select t.id from tiles t
         join boards b on b.id = t.board_id
         join members m on m.id = b.member_id
        where m.display_name = 'Mid-setup' and t.position = 0),
      'Walk the dog', 3, 'walks')$$,
  'and they can write a Goal, which is what the missing Board denied them');

-- ---------------------------------------------------------------------------------------
-- Sealing treats them as an ordinary Member
-- ---------------------------------------------------------------------------------------

select act_as_postgres();
update years set setup_deadline = now() - interval '1 minute',
                 play_opens_at  = now() - interval '1 minute' where family_id = :'family_id';
update votes set closes_at = now() - interval '1 minute'
 where year_id = (select id from years where family_id = :'family_id');

select is(seal_due_boards(), 2, 'both Boards seal together on the Family''s clock');

select isnt(
  (select b.sealed_at from boards b
     join members m on m.id = b.member_id where m.display_name = 'Mid-setup'),
  null,
  'including the one that used not to exist');

-- ---------------------------------------------------------------------------------------
-- And after the seal, §21 still applies
-- ---------------------------------------------------------------------------------------

insert into members (family_id, account_id, display_name, role, status)
  values (:'family_id', '00000000-0000-4000-8000-0000000000b3', 'After-seal', 'member', 'pending');

select act_as('00000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$select approve_member((select id from members where display_name = 'After-seal'))$$,
  'a Member approved after the seal is approved too');

select act_as_postgres();
select isnt(
  (select b.joined_late_at from boards b
     join members m on m.id = b.member_id where m.display_name = 'After-seal'),
  null,
  'and DOES get §21.4''s marker, because they really did join late');

select isnt(
  (select b.personal_setup_deadline from boards b
     join members m on m.id = b.member_id where m.display_name = 'After-seal'),
  null,
  'and §21.1''s own seven days');

rollback;
