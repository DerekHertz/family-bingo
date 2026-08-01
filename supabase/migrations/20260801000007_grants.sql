-- Table privileges — the layer underneath RLS.
--
-- RLS decides WHICH ROWS a caller sees; a GRANT decides whether they may address the
-- table at all. Both are needed: a table with RLS enabled and a permissive grant is one
-- forgotten policy away from being readable, and this is a cheap second lock on a door
-- whose payload is photographs of children (ADR-0004).
--
-- `anon` is granted NOTHING. An unauthenticated caller cannot reach any application
-- table, so they get a permission error rather than an empty result. That does not
-- conflict with api.md §9 — the "zero rows, never 403" rule is about a row-level denial,
-- which would otherwise confirm that a particular resource exists. A table-level denial
-- to a caller with no session reveals nothing about anyone.
--
-- The verbs granted per table are the ones the product actually permits, and no more.
-- Note in particular that `increments` gets INSERT and DELETE but never UPDATE: the log
-- is append-only, and deleting is the only mutation (PRD §11.3).

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Identity and devices.
grant select, insert, update on accounts to authenticated;
grant select, insert, update, delete on device_tokens to authenticated;

-- The social side.
grant select, update on families to authenticated;

-- UPDATE on `members` is COLUMN-SCOPED, and that is load-bearing rather than tidy.
--
-- Two policies grant UPDATE on this table: members_self_update (a Member editing
-- themselves) and members_organizer_update (the Organizer approving or administering).
-- A row-level policy cannot see WHICH columns an UPDATE touched, so without this grant
-- the self-update policy would also permit:
--
--     update members set role = 'organizer' where id = <my own id>;   -- §3.3 bypassed
--     update members set family_id = '<someone else''s family>';      -- §8.1 bypassed
--
-- The second is the serious one: it walks the Member straight through the Family
-- boundary and into visible_family_ids() for a Family they were never invited to.
--
-- `status` is included because the Organizer needs it to approve a pending Member. A
-- Member setting their own status is harmless — they can only set it on a row they
-- already control, and controlled_member_ids() requires `active` to match at all, so a
-- pending Member cannot use it to promote themselves.
grant select, delete on members to authenticated;
grant update (display_name, avatar_url, digest_opt_in, status) on members to authenticated;

grant select, insert, update on invitations to authenticated;

-- The Year and the Board are shaped by lifecycle RPCs, never by direct client writes.
grant select on years to authenticated;
grant select on family_goals to authenticated;
grant select on goals to authenticated;
grant select on boards to authenticated;
grant select on tiles to authenticated;

-- The Center Vote: single-row writes with no cross-table invariant.
grant select on votes to authenticated;
grant select, insert, delete on proposals to authenticated;
grant select, insert, update on ballots to authenticated;

-- Play. No UPDATE on increments, deliberately (PRD §11.3).
grant select, insert, delete on increments to authenticated;
grant select, insert, delete on attachments to authenticated;
-- Milestones are emitted by the server: a Bingo is a social claim and must not be
-- forgeable. Revisions are written by swap_tile() and are never deleted (PRD §18.4).
grant select on milestones to authenticated;
grant select on revisions to authenticated;

-- Wrapped is read-only forever (PRD §20.10).
grant select on wrapped to authenticated;
grant select on wrapped_member_cards to authenticated;
grant select on wrapped_awards to authenticated;

-- The RLS helpers. They take no user input beyond auth.uid() and leak nothing.
grant execute on function visible_family_ids() to authenticated;
grant execute on function visible_member_ids() to authenticated;
grant execute on function controlled_member_ids() to authenticated;
grant execute on function is_organizer_of(uuid) to authenticated;
grant execute on function family_of_member(uuid) to authenticated;
grant execute on function family_of_board(uuid) to authenticated;
grant execute on function family_of_vote(uuid) to authenticated;
grant execute on function tile_is_loggable(uuid) to authenticated;
grant execute on function safe_uuid(text) to authenticated;
