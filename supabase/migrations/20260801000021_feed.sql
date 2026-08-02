-- Slice 14, server half — the Feed.
--
-- Acceptance test (PRD §14):
--   Given a Family with recent activity
--   When a Member opens the Feed
--   Then they see a reverse-chronological list of Increments (with notes), Milestones,
--   Swaps, and vote outcomes — for their Family only
--   And given an Account in a different Family queries the same endpoint
--   Then zero rows are returned
--
-- A view, not an RPC, and no policy of its own. `security_invoker` makes every base
-- table's existing read policy apply to whoever is selecting, so the Feed is scoped by
-- the same six policies that already scope Increments, Milestones, Revisions, Votes and
-- Members — the ones with negative tests already written against them.
--
-- That is the whole argument for this shape. A hand-written `where family_id = ...`
-- here would be a second copy of the boundary that ADR-0004 exists to prevent, and it
-- would be the copy most likely to drift, because the Feed is the one surface that
-- reads from every table at once. The second half of the acceptance test passes because
-- there is nothing here for it to pass through: an outsider's zero rows come from
-- increments_family_read and its five siblings, unchanged.
--
-- It also means a pending Member sees an empty Feed rather than an error, which is
-- §3.2 — visible_family_ids() requires `status = 'active'` and matches nothing for them.

-- ---------------------------------------------------------------------------------
-- Which Year an event belongs to
-- ---------------------------------------------------------------------------------
--
-- Every kind below is Year-scoped (§14.1) except one: a Member joins a Family, not a
-- Year. They are attributed to the Year that was open when they joined — which is what
-- puts a §21 late joiner in the Feed of the Year they actually walked into.
--
-- The fallback is for founders. create_family() makes the Organizer a Member before
-- open_year() exists to be called, so their own joining predates every Year the Family
-- will ever have; without it, the moment the Family began would show up in no Feed at
-- all.
--
-- Invoker rights, unlike every other helper in this codebase. The SECURITY DEFINER ones
-- exist because a policy on `members` cannot read `members` without recursing; this one
-- has no such problem, and as a definer it would happily name a Year to anyone who could
-- guess a family_id. Left as an invoker it reads `years` through years_read and returns
-- null for a Family the caller cannot see — the same answer the boundary gives everywhere
-- else. No `set search_path` either, so the planner can inline it into the view.
create or replace function year_current_at(target_family_id uuid, at timestamptz)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select y.id from years y
      where y.family_id = target_family_id and y.created_at <= at
      order by y.created_at desc limit 1),
    (select y.id from years y
      where y.family_id = target_family_id
      order by y.created_at asc limit 1)
  )
$$;

-- ---------------------------------------------------------------------------------
-- The Feed
-- ---------------------------------------------------------------------------------
--
-- §14.2, one branch per kind. Ordering is by `created_at` descending and the client
-- paginates on it (§14.1) — server-stamped on insert for exactly this reason
-- (schema.md §5, `occurred_at` vs `created_at`: a Member may say a walk happened
-- yesterday, but the Feed is the order the Family learned about things).
--
-- Wide and sparse rather than a jsonb payload: these are five different events with
-- five different shapes, and naming the columns is what lets the client render them
-- without parsing. `kind` says which columns are meaningful.
--
-- Decorative joins are LEFT. The Goal text on an Increment is a nicety; if a policy ever
-- disagrees about a Goal the Feed should lose the caption, not the event.
create or replace view feed
with (security_invoker = true) as

-- Increments, with notes and Attachments (§14.2). The bulk of the Feed by far — ~3,300
-- a year in a family of six, which is exactly why they are Feed-only and never pushed
-- (§15.2, api.md §6).
select
  i.id,
  'increment'::text                          as kind,
  i.created_at,
  b.member_id                                as member_id,
  y.family_id,
  y.id                                       as year_id,
  t.id                                       as tile_id,
  t.position,
  coalesce(g.text, fg.text)                  as goal_text,
  i.note,
  a.storage_path                             as attachment_path,
  null::text                                 as milestone_type,
  null::int                                  as line_index,
  null::text                                 as before_text,
  null::int                                  as before_target,
  null::text                                 as after_text,
  null::int                                  as after_target,
  null::text                                 as vote_kind,
  null::text                                 as vote_outcome
from increments i
join tiles  t on t.id = i.tile_id
join boards b on b.id = t.board_id
join years  y on y.id = b.year_id
left join goals        g  on g.id  = t.goal_id
left join family_goals fg on fg.id = t.family_goal_id
left join attachments  a  on a.increment_id = i.id

union all

-- Milestones. The Feed carries all four kinds; only these are also pushed (§15.1).
select
  m.id,
  'milestone',
  m.created_at,
  m.member_id,
  y.family_id,
  m.year_id,
  m.tile_id,
  t.position,
  coalesce(g.text, fg.text),
  null, null,
  m.type,
  m.line_index,
  null, null, null, null, null, null
from milestones m
join years y on y.id = m.year_id
left join tiles        t  on t.id  = m.tile_id
left join goals        g  on g.id  = t.goal_id
left join family_goals fg on fg.id = t.family_goal_id

union all

-- Swaps. Every one is shown to the Family (CONTEXT.md, Swap) — that visibility is the
-- whole enforcement mechanism, since three per Year is a budget and not a prohibition.
select
  r.id,
  'swap',
  r.created_at,
  b.member_id,
  y.family_id,
  y.id,
  r.tile_id,
  t.position,
  null,
  null, null, null, null,
  r.before_text,
  r.before_target,
  r.after_text,
  r.after_target,
  null, null
from revisions r
join boards b on b.id = r.board_id
join years  y on y.id = b.year_id
left join tiles t on t.id = r.tile_id

union all

-- Vote outcomes, not the voting. A Ballot is changeable until the Setup Window closes
-- (CONTEXT.md, Ballot) and is nobody else's business while it still is; what the Family
-- learns is what was decided.
select
  v.id,
  'vote_resolved',
  v.resolved_at,
  null,
  y.family_id,
  v.year_id,
  null, null,
  p.text,
  null, null, null, null, null, null, null, null,
  v.kind,
  v.outcome
from votes v
join years y on y.id = v.year_id
-- A goal Vote's outcome is the winning Proposal's id as text, or NULL when none won
-- (20260801000015_center_vote.sql). Read from the Proposal rather than from
-- `family_goals`, because a mode Vote that went personal leaves a decided goal Vote with
-- no Family Goal to show, and the Family still voted on something.
left join proposals p on v.kind = 'goal' and p.id::text = v.outcome
where v.resolved_at is not null

union all

-- Members joining (§14.2). Only active ones: a pending Member has asked, not arrived,
-- and the Organizer must still agree (CONTEXT.md, Invitation).
select
  mem.id,
  'member_joined',
  mem.joined_at,
  mem.id,
  mem.family_id,
  year_current_at(mem.family_id, mem.joined_at),
  null, null, null, null, null, null, null, null, null, null, null, null, null
from members mem
where mem.status = 'active';

comment on view feed is
  'PRD §14. Reverse-chronological, Family- and Year-scoped, paginated on created_at. '
  'Carries no policy of its own: security_invoker means every row is filtered by the '
  'read policy of the table it came from, so the boundary is stated once (ADR-0004).';

-- `anon` is granted nothing anywhere (20260801000007_grants.sql) and a new view does not
-- change that — no grant to PUBLIC is made here, so an unauthenticated caller cannot
-- address it at all.
grant select on feed to authenticated;
revoke execute on function year_current_at(uuid, timestamptz) from public, anon;
grant execute on function year_current_at(uuid, timestamptz) to authenticated;
