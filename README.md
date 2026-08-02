# Family Bingo

An annual goal-setting game for families. Each person fills a 5×5 board with personal
goals for the year and works to complete them, while their family watches, cheers, and
gets notified as squares fall.

**The loop:** author 24 goals in December → seal on January 1 → log progress all year →
complete Tiles → hit Bingo → chase Blackout.

**What makes it not a habit tracker:** the Family is a participant, not an audience. It
votes on the shared Center Tile, sees every increment in a common feed, gets notified on
milestones, and sees every mid-year swap.

> Status: **domain layer and database built; no client yet.** `src/domain/` holds the
> pure game logic and `supabase/` the schema, RLS policies and pgTAP tests. Still to
> come: the RPCs, the Edge Functions (`sharpen`, `notify`, `digest`), the `pg_cron`
> jobs, and the Expo app.

## Running it

```sh
npm install
npm run typecheck      # tsc
npm test               # vitest — the pure domain layer
npm run db:start       # local Supabase (needs Docker)
npm run db:reset       # apply migrations from scratch
npm run db:test        # pgTAP — RLS, constraints, storage
npm run test:integration  # HTTP, against the running stack (needs db:start)
```

## Documents

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | **Read first.** The glossary — every domain term, and the words to avoid |
| [`docs/prd.md`](docs/prd.md) | Requirements, as 21 thin vertical slices with acceptance tests |
| [`docs/schema.md`](docs/schema.md) | Data model, constraints, RLS policies, the twelve Lines |
| [`docs/api.md`](docs/api.md) | Architecture, API surface, sequence diagrams |
| [`docs/adr/`](docs/adr/) | The seven decisions that were hard to reverse and genuinely contested |

## Stack

Expo (React Native) + TypeScript · Supabase (Postgres + Auth + Storage + Edge Functions +
`pg_cron`) · `claude-opus-5` for goal Sharpening.

## Working on this

**Test-first, one vertical slice at a time.** Each slice in the PRD cuts through the whole
stack — migration → RLS policy → Edge Function → screen — and ends at something a person
can actually do. Write its acceptance test, watch it fail, make it pass.

Four things worth knowing before touching the code, each of which looks like an oversight
until you know why:

- **There is no ranking, leaderboard, or winner.** Boards are self-authored, so ranking them would measure who set the easiest goals ([ADR-0001](docs/adr/0001-personal-boards.md)). Wrapped Awards are the one narrow exception, and are deliberately not a ladder ([ADR-0006](docs/adr/0006-wrapped-awards.md)).
- **There are no streaks, and pace is never enforced.** A missed month must never make a Tile permanently unachievable ([ADR-0002](docs/adr/0002-cumulative-goals-only.md)).
- **Sharpening advises and never blocks.** It must handle *"Be a better father"* gracefully — no rejection, no lecture (PRD §7.5).
- **Every RLS policy needs a negative test** asserting another Family gets *zero rows*. The payload behind that boundary is photographs of children ([ADR-0004](docs/adr/0004-supabase-rls-boundary.md), [ADR-0005](docs/adr/0005-photo-attachments.md)).
