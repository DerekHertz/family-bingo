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
-- the same policies that already scope Increments, Milestones, Revisions, Votes and
-- Members — the ones with negative tests already written against them.
--
-- That is the whole argument for this shape. A hand-written `where family_id = ...`
-- here would be a second copy of the boundary that ADR-0004 exists to prevent, and it
-- would be the copy most likely to drift, because the Feed is the one surface that
-- reads from every table at once. The second half of the acceptance test passes because
-- there is nothing here for it to pass through: an outsider's zero rows come from
-- increments_family_read and its siblings, unchanged.
--
-- It also means a pending Member sees an empty Feed rather than an error, which is
-- §3.2 — visible_family_ids() requires `status = 'active'` and matches nothing for them.

-- ---------------------------------------------------------------------------------
-- A Member joins when the Organizer agrees, not when they ask
-- ---------------------------------------------------------------------------------
--
-- Slice 3's function, with one column added, because building the Feed is what exposed
-- the bug. `members.joined_at` defaults to now() when the PENDING row is written, and
-- approve_member() never moved it — so a Member who asked in January and was approved in
-- March carried a January timestamp. The Feed is ordered by that timestamp, so their
-- arrival would surface two months down the page instead of at the top (§14.1), and the
-- Year it is attributed to would be the one they asked during rather than the one they
-- joined.
--
-- The glossary already settles which instant is right. CONTEXT.md, Invitation: "Following
-- it does not make someone a Member — it asks to become one, and the Organizer must
-- agree." Joining is the agreement. `joined_at` now names the moment it happened.
create or replace function approve_member(member_id uuid)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  target members;
begin
  select * into target from members where id = approve_member.member_id;
  if target.id is null or not is_organizer_of(target.family_id) then
    -- Same error either way: an outsider learns nothing about whether the row exists.
    raise exception 'only the Organizer may approve a Member' using errcode = '42501';
  end if;

  update members set status = 'active', joined_at = now()
   where id = approve_member.member_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------------
-- Which Year a joining belongs to
-- ---------------------------------------------------------------------------------
--
-- Every kind in the Feed is Year-scoped (§14.1) except one: a Member joins a Family, not
-- a Year. Three cases, in the order they are asked, because "the Year that was open when
-- they joined" does not exist for two of them:
--
--   1. A Year was under way. That one — which is what puts a §21 late joiner in the Feed
--      of the Year they actually walked into.
--   2. Nothing was under way: they arrived between a Freeze and the next opening, or
--      before the Family had any Year at all (a founder, since create_family() makes the
--      Organizer a Member before open_year() exists to be called). The next Year is the
--      one they will play, so it is the one that should show them arriving. Attributing
--      them backwards to a frozen Year would drop a new event into permanent family
--      history (§20.1, CONTEXT.md Freeze) and leave them absent from the Year they play.
--   3. Every Year is history and there is no next one. Nowhere else to put them.
--
-- Invoker rights, unlike every other helper in this codebase. The SECURITY DEFINER ones
-- exist because a policy on `members` cannot read `members` without recursing; this one
-- has no such problem, and as a definer it would happily name a Year to anyone who could
-- guess a family_id. Left as an invoker it reads `years` through years_read and returns
-- null for a Family the caller cannot see — the same answer the boundary gives everywhere
-- else. No `set search_path` either, so the planner can inline it into the view; on a
-- non-definer function a hostile search_path can only redirect the caller to objects they
-- could already reach, so there is nothing to escalate.
create or replace function year_of_joining(target_family_id uuid, at timestamptz)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select y.id from years y
      where y.family_id = target_family_id
        and y.created_at <= at
        and (y.frozen_at is null or y.frozen_at > at)
      order by y.created_at desc limit 1),
    (select y.id from years y
      where y.family_id = target_family_id and y.created_at > at
      order by y.created_at asc limit 1),
    (select y.id from years y
      where y.family_id = target_family_id
      order by y.created_at desc limit 1)
  )
$$;

-- ---------------------------------------------------------------------------------
-- The Feed
-- ---------------------------------------------------------------------------------
--
-- §14.2, one branch per kind. Ordering is by `created_at` descending and the client
-- paginates on it (§14.1).
--
-- `created_at` is the moment the Family learned of the event, which for three kinds is
-- the column of that name and for two is not: a Vote contributes `resolved_at` and a
-- joining contributes `joined_at`. All three are server clocks stamped when the thing
-- happened, which is what schema.md §4.2 requires of the name. It is deliberately NOT
-- `increments.occurred_at` — a Member may say a walk happened yesterday, but the Feed is
-- the order the Family found out (schema.md §5).
--
-- Wide and sparse rather than a jsonb payload: these are five different events with five
-- different shapes, naming the columns is what lets a client render them without parsing,
-- and PostgREST can neither filter nor type a jsonb blob. `kind` says which columns are
-- meaningful.
--
-- EVERY branch aliases every column, including its nulls. A UNION ALL takes column names
-- from the first branch alone, so a later branch with its slots transposed is a silent
-- data corruption that type-compatibility will not catch and — for two `text` columns
-- like before_text and after_text — no test would either. The aliases are for the
-- reviewer; the parser ignores them.
--
-- `id` is the source row's id and is unique only with `kind`. Two kinds could in
-- principle collide; clients key on the pair.
--
-- Decorative joins are LEFT. The Goal text on an Increment is a nicety; if a policy ever
-- disagrees about a Goal the Feed should lose the caption, not the event.
create or replace view feed
with (security_invoker = true) as

-- Increments, with notes and Attachments (§14.2). The bulk of the Feed by far — ~3,300 a
-- year in a family of six, which is exactly why they are Feed-only and never pushed
-- (§15.2, api.md §6).
select
  i.id                                       as id,
  'increment'::text                          as kind,
  i.created_at                               as created_at,
  b.member_id                                as member_id,
  y.family_id                                as family_id,
  y.id                                       as year_id,
  t.id                                       as tile_id,
  t.position                                 as position,
  coalesce(g.text, fg.text)                  as goal_text,
  i.note                                     as note,
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
  m.id                                       as id,
  'milestone'::text                          as kind,
  m.created_at                               as created_at,
  m.member_id                                as member_id,
  y.family_id                                as family_id,
  m.year_id                                  as year_id,
  m.tile_id                                  as tile_id,
  t.position                                 as position,
  coalesce(g.text, fg.text)                  as goal_text,
  null::text                                 as note,
  null::text                                 as attachment_path,
  m.type                                     as milestone_type,
  m.line_index                               as line_index,
  null::text                                 as before_text,
  null::int                                  as before_target,
  null::text                                 as after_text,
  null::int                                  as after_target,
  null::text                                 as vote_kind,
  null::text                                 as vote_outcome
from milestones m
join years y on y.id = m.year_id
left join tiles        t  on t.id  = m.tile_id
left join goals        g  on g.id  = t.goal_id
left join family_goals fg on fg.id = t.family_goal_id

union all

-- Swaps. Every one is shown to the Family (CONTEXT.md, Swap) — that visibility is the
-- whole enforcement mechanism, since three per Year is a budget and not a prohibition.
select
  r.id                                       as id,
  'swap'::text                               as kind,
  r.created_at                               as created_at,
  b.member_id                                as member_id,
  y.family_id                                as family_id,
  y.id                                       as year_id,
  r.tile_id                                  as tile_id,
  t.position                                 as position,
  null::text                                 as goal_text,
  null::text                                 as note,
  null::text                                 as attachment_path,
  null::text                                 as milestone_type,
  null::int                                  as line_index,
  r.before_text                              as before_text,
  r.before_target                            as before_target,
  r.after_text                               as after_text,
  r.after_target                             as after_target,
  null::text                                 as vote_kind,
  null::text                                 as vote_outcome
from revisions r
join boards b on b.id = r.board_id
join years  y on y.id = b.year_id
left join tiles t on t.id = r.tile_id

union all

-- Vote outcomes, not the voting. A Ballot is changeable until the Setup Window closes
-- (CONTEXT.md, Ballot) and is nobody else's business while it still is; what the Family
-- learns is what was decided.
--
-- `vote_outcome` is that decision in words, for both kinds — 'shared'/'personal' for the
-- mode, and the Family Goal's own text for the goal. The `votes.outcome` column holds the
-- winning Proposal's id for a goal Vote, and a raw uuid is not something a Feed row can
-- render.
--
-- A goal Vote appears only if it produced a Family Goal. Two reasons, and either alone
-- would do it: resolve_center_vote() stamps `outcome` with the winner even when the mode
-- resolved to personal, so showing it would announce a Family Goal that is on nobody's
-- Board; and a Vote that resolved with no Proposal at all has no outcome to report, only
-- a row saying so.
select
  v.id                                       as id,
  'vote_resolved'::text                      as kind,
  v.resolved_at                              as created_at,
  null::uuid                                 as member_id,
  y.family_id                                as family_id,
  v.year_id                                  as year_id,
  null::uuid                                 as tile_id,
  null::int                                  as position,
  null::text                                 as goal_text,
  null::text                                 as note,
  null::text                                 as attachment_path,
  null::text                                 as milestone_type,
  null::int                                  as line_index,
  null::text                                 as before_text,
  null::int                                  as before_target,
  null::text                                 as after_text,
  null::int                                  as after_target,
  v.kind                                     as vote_kind,
  case v.kind when 'mode' then v.outcome else fg.text end
                                             as vote_outcome
from votes v
join years y on y.id = v.year_id
left join family_goals fg on fg.year_id = v.year_id
where v.resolved_at is not null
  and (v.kind = 'mode' or fg.id is not null)

union all

-- Members joining (§14.2). Only active ones: a pending Member has asked, not arrived,
-- and the Organizer must still agree (CONTEXT.md, Invitation).
--
-- Attributed to the Member, as every kind here is. A Managed Member's arrival is theirs,
-- not their Guardian's (§4.2) — the Feed never names an Account.
select
  mem.id                                     as id,
  'member_joined'::text                      as kind,
  mem.joined_at                              as created_at,
  mem.id                                     as member_id,
  mem.family_id                              as family_id,
  year_of_joining(mem.family_id, mem.joined_at)
                                             as year_id,
  null::uuid                                 as tile_id,
  null::int                                  as position,
  null::text                                 as goal_text,
  null::text                                 as note,
  null::text                                 as attachment_path,
  null::text                                 as milestone_type,
  null::int                                  as line_index,
  null::text                                 as before_text,
  null::int                                  as before_target,
  null::text                                 as after_text,
  null::int                                  as after_target,
  null::text                                 as vote_kind,
  null::text                                 as vote_outcome
from members mem
where mem.status = 'active';

comment on view feed is
  'PRD §14. Reverse-chronological, Family- and Year-scoped, paginated on created_at. '
  'Carries no policy of its own: security_invoker means every row is filtered by the '
  'read policy of the table it came from, so the boundary is stated once (ADR-0004).';

-- `anon` is granted nothing anywhere (20260801000007_grants.sql) and a new view does not
-- change that — no grant to PUBLIC is made here, so an unauthenticated caller cannot
-- address it at all. The function needs the opposite treatment: EXECUTE defaults to
-- PUBLIC, and the blanket revoke in that migration ran fourteen migrations before this
-- one existed.
grant select on feed to authenticated;
revoke execute on function year_of_joining(uuid, timestamptz) from public, anon;
grant execute on function year_of_joining(uuid, timestamptz) to authenticated;

-- The Feed reads from five tables, and schema.md §7 only ever indexed the two that carry
-- its volume. These are the other three, on the column it orders by.
create index if not exists revisions_created_idx on revisions (created_at desc);
create index if not exists members_family_joined_idx on members (family_id, joined_at desc);
create index if not exists votes_resolved_idx on votes (year_id, resolved_at desc)
  where resolved_at is not null;
