-- The grants the Edge Functions need, and not one more.
--
-- Found by the §16.5 integration test, which is the first thing in this repo to talk to
-- the running stack over HTTP rather than through psql: `service_role` has no privileges
-- on any application table. 20260801000007_grants.sql grants to `authenticated` and
-- revokes from `anon`, and never mentions the third role — and this project does not
-- auto-expose new entities (supabase/config.toml, `auto_expose_new_tables`), so the
-- default is nothing.
--
-- Which means both Edge Functions written so far are broken in a way no test could have
-- caught: `notify` cannot read its own outbox, and `reap-attachments` cannot read the
-- objects it is supposed to remove. Neither would have failed until deployment.
--
-- The fix is not `grant all on all tables to service_role`. That role bypasses RLS
-- entirely — it is the one identity in the system for which the Family boundary does not
-- exist (ADR-0004) — so what it may touch is worth enumerating by hand, and worth being
-- short. Every grant below names a function that needs it.

-- `notify` (§15): drain the outbox, stamp what was sent, count what failed.
grant select, update on notifications to service_role;

-- ...render the copy. It needs the Member's display name and nothing else about them;
-- SELECT is the whole verb.
grant select on members to service_role;

-- ...and prune a token Expo reports as unregistered (§15.4).
grant select, delete on device_tokens to service_role;

-- `reap-attachments` (§16.6): find the objects whose bytes are owed a removal, and mark
-- them reaped once Storage confirms they are gone.
grant select, update on orphaned_objects to service_role;

-- Deliberately absent, and each for a reason:
--
--   increments, milestones, boards, tiles, goals — nothing server-side writes them. They
--     are written by the Member or by a SECURITY DEFINER trigger, which runs as the table
--     owner and needs no grant.
--   attachments — `reap-attachments` acts on rows that are already gone; that is what
--     orphaned_objects is for.
--   accounts, invitations, ballots, proposals — no function reads them, and a photo of a
--     child is not the only thing in here worth keeping behind the boundary.
--   INSERT on notifications — the outbox is written by triggers, as the owner. A service
--     that could insert its own rows could decide what a Family gets interrupted for.
