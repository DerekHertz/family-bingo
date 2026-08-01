# Supabase, with Row Level Security as the Family privacy boundary

The backend is Supabase — Postgres, Auth, Storage, Edge Functions and `pg_cron` — and the
rule that *nothing crosses a Family boundary* is enforced by **Row Level Security in the
database**, not by authorization checks in application code.

The deciding argument is not developer convenience. It is that the payload behind this
boundary is photographs of children. In a hand-rolled API, the boundary holds only as long
as every endpoint, forever, remembers the right `WHERE` clause; one omission leaks a
family's photos to a stranger. With RLS, a buggy client, a forgotten check, or a
compromised endpoint still cannot read another Family's rows.

## Considered options

**FastAPI + Postgres, fully custom.** Matches the existing skill set exactly and carries
no vendor lock-in. Rejected because it means building auth, storage plumbing, APNs/FCM
push, a scheduler, and migrations before a single tile is tappable — and because
authorization would then live in application code, which is precisely what we did not
want for this payload.

**Supabase for data, FastAPI for business logic.** A close second, and genuinely
tempting: Python fluency, the `anthropic` SDK already in hand, and policies expressed as
testable application code rather than SQL. Rejected because it gives up the
database-level safety net that motivated the choice, and adds a service to operate.

**Firebase.** The best push story of the options. Rejected because the model is deeply
relational — 12 lines over 25 tiles, aggregates, revision history, family scoping — and
Firestore would mean denormalizing all of it by hand, with per-read pricing on a
feed-heavy app.

## Consequences

- **Every RLS policy needs a negative test.** A policy without a pgTAP test asserting that a different Family's Account gets *zero rows* is an untested security control. This is non-negotiable, not a nice-to-have.
- Denied reads return **empty results, not 403** — a 403 confirms the resource exists; zero rows tells an outsider nothing.
- Storage follows the same boundary: private bucket, Family id as the first path segment, short-TTL signed URLs, and a direct-object-URL test proving both unauthenticated and cross-Family access fail.
- RLS policies for multi-family membership plus Guardian access are genuinely subtle to write and to read. That is the price of the guarantee; budget review time for them.
- Edge Functions are Deno/TypeScript, not Python. This aligns with the Expo client but means the backend is not in the language we are fastest in.
- Real vendor coupling. Migrating off Supabase would mean rebuilding auth, storage, and the policy layer. We judged the guarantee worth the lock-in.
- The Claude API key lives in an Edge Function and never reaches the client — this is why a pure client-plus-BaaS architecture was never viable ([ADR-0002](0002-cumulative-goals-only.md) makes Sharpening core, and Sharpening needs a server).
