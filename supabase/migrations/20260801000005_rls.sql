-- Row Level Security — the Family privacy boundary.
--
-- This file IS the authorization for the whole app. It is not a second layer behind
-- application checks (ADR-0004, PRD §8.1 P5). The deciding argument was never developer
-- convenience: the payload behind this boundary is photographs of children, and in a
-- hand-rolled API the boundary holds only as long as every endpoint, forever, remembers
-- the right WHERE clause.
--
-- Two rules shape every policy below (schema.md §4.2):
--
--   READS are Family-wide  — you see everything your Family does.
--   WRITES are self-only   — you change only what is yours, or your Managed Members'.
--
-- A denied read returns ZERO ROWS, never an error. A 403 confirms the resource exists;
-- zero rows tells an outsider nothing (api.md §9).
--
-- Every policy here has a negative pgTAP test in supabase/tests/ asserting that a caller
-- who should not reach a row gets zero rows — cross-Family in rls_family_boundary, and
-- same-Family-but-not-entitled in rls_write_policies. A policy without one is an
-- untested security control (PRD §8.1 P2).

-- ---------------------------------------------------------------------------------
-- Helpers
--
-- All SECURITY DEFINER. That is the one deliberate exception to api.md §2's rule, and
-- it is structural: these must read `members` while a policy ON `members` is being
-- evaluated, which would otherwise recurse.
-- ---------------------------------------------------------------------------------

-- Families the caller can see: those where they are an ACTIVE Member, either directly
-- or as a Guardian.
--
-- `status = 'active'` is doing real work: it is what makes a pending Member unable to
-- read anything at all (PRD §3.2, §8.1 P3). Do not relax it.
create or replace function visible_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from members
   where status = 'active'
     and (account_id = auth.uid() or guardian_account_id = auth.uid());
$$;

-- Every Member of every Family the caller can see. Almost every read policy below
-- reduces to this, and saying it once means one place to get it right.
create or replace function visible_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from members where family_id in (select visible_family_ids());
$$;

-- Members the caller may act AS: themselves, plus any Managed Member they guard.
-- This is what makes Account -> Member one-to-many safe (ADR-0003): the logged-in
-- Account is not the player, and every write path has to say which Member it means.
create or replace function controlled_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from members
   where status = 'active'
     and (account_id = auth.uid() or guardian_account_id = auth.uid());
$$;

create or replace function is_organizer_of(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from members
     where family_id = target_family_id
       and status = 'active'
       and role = 'organizer'
       and (account_id = auth.uid() or guardian_account_id = auth.uid())
  );
$$;

create or replace function family_of_member(target_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from members where id = target_member_id;
$$;

create or replace function family_of_board(target_board_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.family_id from boards b
    join members m on m.id = b.member_id
   where b.id = target_board_id;
$$;

create or replace function family_of_vote(target_vote_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select y.family_id from votes v
    join years y on y.id = v.year_id
   where v.id = target_vote_id;
$$;

-- Increments cannot be logged before the Board seals or after the Year freezes, and
-- there is no backdating (PRD §11.5, §20.1). A frozen Year is permanently read-only, so
-- this gates deletion too — otherwise a Member could quietly rewrite family history
-- after Wrapped had already been generated from it.
create or replace function tile_is_loggable(target_tile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tiles t
      join boards b on b.id = t.board_id
      join years  y on y.id = b.year_id
     where t.id = target_tile_id
       and b.sealed_at is not null
       and y.frozen_at is null
  );
$$;

-- ---------------------------------------------------------------------------------
-- Accounts and devices — visible only to their owner. A Family sees each other's
-- Members, never each other's Accounts.
-- ---------------------------------------------------------------------------------

create policy accounts_self_read on accounts for select to authenticated
  using (id = auth.uid());
create policy accounts_self_update on accounts for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy accounts_self_insert on accounts for insert to authenticated
  with check (id = auth.uid());

create policy device_tokens_self_all on device_tokens for all to authenticated
  using (account_id = auth.uid()) with check (account_id = auth.uid());

-- ---------------------------------------------------------------------------------
-- Families and Members
-- ---------------------------------------------------------------------------------

create policy families_read on families for select to authenticated
  using (id in (select visible_family_ids()));
create policy families_organizer_update on families for update to authenticated
  using (is_organizer_of(id)) with check (is_organizer_of(id));

-- A pending Member matches nothing here, and so reads nothing — not the Feed, not
-- Boards, not other Members' names (PRD §3.2).
create policy members_read on members for select to authenticated
  using (family_id in (select visible_family_ids()));

-- A Member may edit their own display name, avatar and digest preference — and ONLY
-- those. The restriction is a column-level GRANT in 20260801000007_grants.sql rather
-- than a predicate here, because a row-level policy cannot see which columns an UPDATE
-- touched. Without it this policy would permit `set role = 'organizer'` (self-promotion
-- past §3.3) and `set family_id = '<someone else's>'`, which would walk the Member
-- straight through the boundary in §8.1.
create policy members_self_update on members for update to authenticated
  using (id in (select controlled_member_ids()))
  with check (id in (select controlled_member_ids()));

-- The Organizer administers the roster: approving pending Members and removing people
-- (PRD §3.3, §3.4).
create policy members_organizer_update on members for update to authenticated
  using (is_organizer_of(family_id)) with check (is_organizer_of(family_id));
create policy members_organizer_delete on members for delete to authenticated
  using (is_organizer_of(family_id));

-- NOTE: there is deliberately NO insert policy on `members`.
--
-- Creating a membership is the privileged operation in this schema — a self-insert
-- policy permissive enough for create_family() would also let anyone write themselves
-- an `active` `organizer` row in a Family whose id they guessed. So every membership is
-- created through a SECURITY DEFINER RPC (create_family, redeem_invitation,
-- create_managed_member) that enforces its own guard. This is a considered deviation
-- from api.md §2's SECURITY INVOKER default, and the reason is written here so it is
-- not "fixed" later.

-- ---------------------------------------------------------------------------------
-- Invitations — Organizer-only, and never readable by token.
--
-- Redemption cannot go through a policy: the invitee is not a Member of the Family yet,
-- so by construction they can see nothing here. redeem_invitation() is SECURITY DEFINER
-- and validates the token itself.
-- ---------------------------------------------------------------------------------

create policy invitations_organizer_read on invitations for select to authenticated
  using (is_organizer_of(family_id));
create policy invitations_organizer_insert on invitations for insert to authenticated
  with check (is_organizer_of(family_id));
create policy invitations_organizer_update on invitations for update to authenticated
  using (is_organizer_of(family_id)) with check (is_organizer_of(family_id));

-- ---------------------------------------------------------------------------------
-- The Year and the Board. Reads are Family-wide; every write is a lifecycle operation
-- (open_year, seal_year, swap_tile, freeze_year) and goes through an RPC.
-- ---------------------------------------------------------------------------------

create policy years_read on years for select to authenticated
  using (family_id in (select visible_family_ids()));

create policy family_goals_read on family_goals for select to authenticated
  using (year_id in (select id from years where family_id in (select visible_family_ids())));

create policy boards_read on boards for select to authenticated
  using (member_id in (select visible_member_ids()));

create policy tiles_read on tiles for select to authenticated
  using (family_of_board(board_id) in (select visible_family_ids()));

-- A Goal is reachable only through the Tile that holds it. An unattached Goal row is
-- readable by nobody, which is why authoring inserts the Goal and links the Tile in one
-- RPC rather than in two client calls.
create policy goals_read on goals for select to authenticated
  using (exists (
    select 1 from tiles t
     where t.goal_id = goals.id
       and family_of_board(t.board_id) in (select visible_family_ids())
  ));

-- ---------------------------------------------------------------------------------
-- The Center Vote. Ballots and Proposals are written directly by the client — they are
-- single-row writes with no invariant spanning tables.
--
-- Both write policies check TWO things: that the caller controls the Member, and that
-- the Vote belongs to that Member's own Family. Checking only the first would let a
-- Guardian who plays in two Families cast their Member's Ballot into the other Family's
-- vote, where resolve_vote() would then count it.
-- ---------------------------------------------------------------------------------

create policy votes_read on votes for select to authenticated
  using (year_id in (select id from years where family_id in (select visible_family_ids())));

create policy proposals_read on proposals for select to authenticated
  using (member_id in (select visible_member_ids()));
create policy proposals_own_insert on proposals for insert to authenticated
  with check (
    member_id in (select controlled_member_ids())
    and family_of_vote(vote_id) = family_of_member(member_id)
  );
create policy proposals_own_delete on proposals for delete to authenticated
  using (member_id in (select controlled_member_ids()));

create policy ballots_read on ballots for select to authenticated
  using (member_id in (select visible_member_ids()));
-- One Ballot per Member per Vote, changeable until the deadline: the UNIQUE constraint
-- makes changing a vote an UPDATE rather than a second row.
create policy ballots_own_insert on ballots for insert to authenticated
  with check (
    member_id in (select controlled_member_ids())
    and family_of_vote(vote_id) = family_of_member(member_id)
  );
create policy ballots_own_update on ballots for update to authenticated
  using (member_id in (select controlled_member_ids()))
  with check (
    member_id in (select controlled_member_ids())
    and family_of_vote(vote_id) = family_of_member(member_id)
  );

-- ---------------------------------------------------------------------------------
-- Play: Increments, Attachments, Milestones, Revisions.
-- ---------------------------------------------------------------------------------

-- Reads are Family-wide: the Feed is the social half of the product (ADR-0005).
create policy increments_family_read on increments for select to authenticated
  using (member_id in (select visible_member_ids()));

-- Writes are self-only: you may log an Increment for a Member you control, on a Tile of
-- your own Board. The second condition matters — without it a Guardian could log against
-- another Member's Tile while attributing it to their own child. The third is §11.5:
-- not before the Board seals, not after the Year freezes, and never backdated.
create policy increments_own_insert on increments for insert to authenticated
  with check (
    member_id in (select controlled_member_ids())
    and (select b.member_id from tiles t join boards b on b.id = t.board_id
          where t.id = increments.tile_id) = increments.member_id
    and tile_is_loggable(tile_id)
  );

-- Deleting is the ONLY mutation permitted on an Increment (PRD §11.3). There is no
-- update policy, deliberately: the log is append-only and it is what makes a Bingo
-- checkable rather than merely claimed. A frozen Year refuses even this (§20.1).
create policy increments_own_delete on increments for delete to authenticated
  using (
    member_id in (select controlled_member_ids())
    and tile_is_loggable(tile_id)
  );

create policy attachments_family_read on attachments for select to authenticated
  using (exists (
    select 1 from increments i
     where i.id = attachments.increment_id
       and i.member_id in (select visible_member_ids())
  ));
create policy attachments_own_insert on attachments for insert to authenticated
  with check (exists (
    select 1 from increments i
     where i.id = attachments.increment_id
       and i.member_id in (select controlled_member_ids())
  ));
create policy attachments_own_delete on attachments for delete to authenticated
  using (exists (
    select 1 from increments i
     where i.id = attachments.increment_id
       and i.member_id in (select controlled_member_ids())
  ));

-- Milestones are emitted by the server as a consequence of the log, never written by a
-- client: a Bingo notification is a social claim and must not be forgeable.
create policy milestones_read on milestones for select to authenticated
  using (member_id in (select visible_member_ids()));

-- A Revision is the permanent record of a Swap and is never deleted (PRD §18.4). It is
-- written by swap_tile(), which is also what keeps boards.swaps_used honest.
create policy revisions_read on revisions for select to authenticated
  using (family_of_board(board_id) in (select visible_family_ids()));

-- ---------------------------------------------------------------------------------
-- Wrapped — read-only to the Family it belongs to, forever (PRD §20.10).
-- ---------------------------------------------------------------------------------

create policy wrapped_read on wrapped for select to authenticated
  using (year_id in (select id from years where family_id in (select visible_family_ids())));

create policy wrapped_member_cards_read on wrapped_member_cards for select to authenticated
  using (member_id in (select visible_member_ids()));

create policy wrapped_awards_read on wrapped_awards for select to authenticated
  using (member_id in (select visible_member_ids()));
