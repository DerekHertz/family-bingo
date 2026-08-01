# A tied Family Goal vote goes to the Organizer, then to the earliest Proposal

Three documents specified this differently, and the disagreement was only visible once
someone tried to write the function:

| Document | Says |
|---|---|
| [`prd.md`](../prd.md) §9.2 | "A tie is broken by the **Organizer**." |
| [`api.md`](../api.md) §7 | "plurality; tie → Organizer." |
| [`FRONTEND_DESIGN.md`](../Windowbox%20mobile%20application%20design/FRONTEND_DESIGN.md) §4.3 | "**Ties go to the earliest proposal.** Deterministic, explainable to a child, no runoff screen." |

Both are kept, in that order. An outright plurality winner takes it; failing that the
Organizer's tiebreak decides if they cast one; failing that the earliest Proposal wins.

## Why not just one of them

**Organizer alone does not terminate.** `pg_cron` seals the Year on a fixed deadline
(§10.1) and PRD §8.4 says no outcome may be blockable by inaction. An Organizer who
never opens the app on December 30th would otherwise leave every Board in the Family
unsealed — the exact failure §8.4 exists to prevent, arriving through the one person
least able to notice it. So a tiebreak owned solely by the Organizer needs a fallback no
matter which document you privilege.

**Earliest Proposal alone discards a real power.** The Organizer breaking ties is listed
among their duties in PRD §2 and CONTEXT.md's definition of Organizer. Removing it
silently narrows a role the glossary defines.

Layering them costs one extra branch and satisfies both.

## Consequences

- `resolveGoalVote` takes an optional `organizerTiebreak`. Absent, resolution is still
  total — which is what lets the seal job call it unattended.
- The outcome is stated as a fact and never as a defeat (FRONTEND_DESIGN §4.3). The UI
  does not need to distinguish which of the three branches produced the winner, and
  should not.
- Proposals still render in arrival order and never re-sort by votes, because arrival
  order is now load-bearing for the tiebreak as well as a display rule.
- If PRD §9.2 or api.md §7 is ever edited, this file is the reason they say something
  narrower than the code does.
