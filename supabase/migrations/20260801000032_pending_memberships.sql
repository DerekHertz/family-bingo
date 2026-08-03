-- What a pending Member is allowed to know: that they are waiting.
--
-- §3.2 is deliberately absolute — "Pending Members can see nothing — not the Feed, not
-- Boards, not other Members' names. This is a hard RLS boundary, not a UI state" — and
-- `visible_family_ids()` enforces it by requiring `status = 'active'`.
--
-- Which means a pending Member cannot read their OWN row either. Building the client
-- found what that costs: they redeem a code, the screen says someone will let them in,
-- and then the app has no way to ever say it again. Home shows the first-run copy
-- ("Start one, or join the one you were invited to"), and re-entering the same code is
-- refused because it has been used. There is no path back to "you are waiting" — not
-- after a relaunch, not after a week.
--
-- The fix is not to relax the boundary. §3.2 is about a Family's data, and none of that
-- is here: this returns the caller's own membership rows and the NAME of the Family they
-- asked to join, which they necessarily already knew — somebody gave them the code.
-- Nothing about who else is in it, what they are doing, or whether it exists at all for
-- anyone but them.
create or replace function pending_memberships()
returns table (member_id uuid, family_id uuid, family_name text, asked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.family_id, f.name, m.joined_at
    from members m
    join families f on f.id = m.family_id
   where m.status = 'pending'
     -- The caller's own rows and nothing else. auth.uid() rather than a parameter, so
     -- there is no argument anybody could pass to widen it.
     and (m.account_id = auth.uid() or m.guardian_account_id = auth.uid())
   order by m.joined_at
$$;

comment on function pending_memberships() is
  'PRD §3.2, from the pending Member''s side. They may know that they asked and which '
  'Family they asked to join — they were given the code — and nothing else about it. '
  'Without this there is no way for the app to tell them they are waiting after a '
  'relaunch, which reads as the request having vanished.';

revoke execute on function pending_memberships() from public, anon;
grant execute on function pending_memberships() to authenticated;
