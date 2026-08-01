# Photo Attachments are allowed, and the compliance cost is accepted knowingly

A Member may optionally attach one photo to an Increment. This was not the cautious
choice and it was not made by accident.

The Feed is the entire social half of this product, and there is a large difference
between a feed that reads `Derek +1 walk · Derek +1 walk · Mom +1 book` and one that
reads `Derek — walk #47, finally saw the herons at the pond`, with a picture of the
herons. The first gets muted in February; the second is the reason a family opens the
app. Same data model, one optional field of difference.

The cost is real: this is a family app, so user-uploaded images means **photographs of
children**, and once the app is publicly listed that carries image storage, moderation
obligations, child-safety duties, and a materially heavier privacy posture. We decided
this deliberately rather than arriving at it by accident in v1 — which is the only reason
this ADR exists.

## Consequences

- **The strictest test in the suite belongs to this feature.** A direct object URL must fail both unauthenticated *and* cross-Family, verified against real storage. Everything else in the app leaking is embarrassing; this leaking is not.
- Private bucket only. Family id as the first path segment, short-TTL signed URLs, Storage policies mirroring [ADR-0004](0004-supabase-rls-boundary.md). No public bucket and no guessable path, ever — not even temporarily during development.
- Deleting an Increment must delete the object, not just the row. Orphaned images of children sitting in a bucket after a user believes they deleted them is the worst version of this feature.
- Photos are scheduled in Phase 3 rather than Phase 1 — the game works without them, so they should not gate the first playable version.
- [ADR-0003](0003-managed-child-profiles.md) is what makes this defensible: every photo posted under a child's profile has an accountable adult Guardian attached, and a real person to contact.
- Before any public listing this feature specifically needs a lawyer's review, alongside the COPPA posture. If that review comes back badly, photos are the thing to drop — the app degrades to text notes and still works.
