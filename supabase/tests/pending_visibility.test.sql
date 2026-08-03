-- What a pending Member may know about their own request (PRD §3.2).
--
-- §3.2 is absolute about a Family's data and this file asserts it stays that way. What it
-- adds is the one fact a pending Member necessarily already has — that they asked to join
-- a Family whose name they were told when somebody handed them the code.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create or replace function act_as(account uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', account::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function family_named(name text) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from families f where f.name = family_named.name
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'alice@example.test', '{"full_name":"Alice"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'bob@example.test',   '{"full_name":"Bob"}'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'carol@example.test', '{"full_name":"Carol"}'::jsonb);

select act_as('00000000-0000-4000-8000-0000000000a1');
select create_family('Smith Family', 'America/New_York');

select set_config('role', 'postgres', true);
insert into members (family_id, account_id, display_name, role, status) values
  (family_named('Smith Family'), '00000000-0000-4000-8000-0000000000a2', 'Bob', 'member', 'pending');

-- ---------------------------------------------------------------------------------
-- §3.2 still holds in every direction that matters
-- ---------------------------------------------------------------------------------

select act_as('00000000-0000-4000-8000-0000000000a2');

select is((select count(*)::int from members), 0,
  'PENDING: Bob still reads no Member rows at all — not even his own (§3.2)');
select is((select count(*)::int from families), 0, 'PENDING: nor the Family');
select is((select count(*)::int from boards), 0, 'PENDING: nor any Board');
select is((select count(*)::int from feed), 0, 'PENDING: nor the Feed');

-- ---------------------------------------------------------------------------------
-- And the one fact he already had
-- ---------------------------------------------------------------------------------

select is((select count(*)::int from pending_memberships()), 1,
  'but he can see that he asked to join something');
select is((select family_name from pending_memberships()), 'Smith Family',
  'and which Family — he was told it when somebody handed him the code');
select isnt((select asked_at from pending_memberships()), null, 'and when');

-- It is his own rows, not a lookup. Nothing here is a parameter anybody could widen.
select act_as('00000000-0000-4000-8000-0000000000a3');
select is((select count(*)::int from pending_memberships()), 0,
  'CROSS-ACCOUNT: Carol sees nothing of Bob''s request');

select act_as('00000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from pending_memberships()), 0,
  'and an active Member has no pending request of their own to see');

-- Once let in, it is no longer pending and the ordinary policies take over.
select act_as('00000000-0000-4000-8000-0000000000a1');
select approve_member((select id from members where display_name = 'Bob'));

select act_as('00000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from pending_memberships()), 0,
  'and it disappears the moment he is let in');
select cmp_ok((select count(*)::int from members), '>', 0,
  'because by then he can read the Family the ordinary way');

select * from finish();
rollback;
