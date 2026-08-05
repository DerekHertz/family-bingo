-- The Feed's mode-Vote row said what was voted, not what the centre became.
--
-- `resolve_center_vote()` stores the two separately and on purpose
-- (20260801000015_center_vote.sql): `votes.outcome` for a mode Vote holds the mode the
-- Family *voted for*, while `years.center_mode` holds what the centre actually is. They
-- come apart on a path §9.3 puts there deliberately — a Family votes `shared` and nobody
-- writes a Proposal, so there is nothing to put on the Tile and the centre resolves to
-- `personal` anyway.
--
-- The view read `v.outcome`, so that Family's Feed announced "The centre is a family goal
-- this year" over twenty-five personal squares. And it was the only thing the Feed said
-- about the Vote: the goal-Vote row is filtered out when no `family_goals` row exists, by
-- the guard three lines below, which the original author added for exactly this hazard —
-- on the other branch.
--
-- §4.3 asks for the outcome "stated as a fact, never as a defeat". A false fact is worse
-- than a defeat. `years` is already joined; this reads the resolved state instead.
--
-- Everything else is 20260801000021_feed.sql unchanged. A view cannot have one column
-- redefined, so the whole thing is restated.

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
  case v.kind when 'mode' then y.center_mode::text else fg.text end
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

