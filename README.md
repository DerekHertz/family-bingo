<div align="center">

# Family Bingo

**An annual goal-setting game for families.** Each person fills a 5×5 board with their own
goals for the year and works to complete them, while their family watches, cheers, and gets
told as squares fall.

[**Live demo**](https://family-bingo.pages.dev) ·
[Product requirements](docs/prd.md) ·
[Design system](docs/Windowbox%20mobile%20application%20design/FRONTEND_DESIGN.md) ·
[Decision records](docs/adr)

[![CI](https://github.com/DerekHertz/family-bingo/actions/workflows/ci.yml/badge.svg)](https://github.com/DerekHertz/family-bingo/actions/workflows/ci.yml)
[![Deploy](https://github.com/DerekHertz/family-bingo/actions/workflows/deploy.yml/badge.svg)](https://github.com/DerekHertz/family-bingo/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> **Status:** deployed as a web app. Sign-up is **invite-only** while it is being tested with
> real families — the live link opens a read-only demo that needs no account. iOS and
> Android are a possible future target; see [Platforms](#platforms) below.

---

## The loop

Write 24 goals in December → the board **seals** when everyone says they are done, or on
1 January, whichever comes first → play from **1 January** → log progress all year →
complete tiles → hit **Bingo** → chase **Blackout**.

The 25th square is the **Centre**, and the family votes on what it is: a shared goal
everyone commits to, or a personal square each Member fills alone.

## What makes it not a habit tracker

The family is a participant, not an audience. It votes on the shared Centre, sees every
increment in a common feed, is told about milestones, and sees every mid-year swap. And
**nothing ranks anybody** — boards are self-authored, so ranking them would only measure who
set the easiest goals ([ADR-0001](docs/adr/0001-personal-boards.md)).

## Things worth a look, if you are reading the code

- **The database is the security boundary.** Every table carries a row-level security policy
  keyed to the requesting account, and every policy has a *negative* test asserting that a
  different family gets **zero rows** ([ADR-0004](docs/adr/0004-supabase-rls-boundary.md)).
  There is no API server: the client talks to Postgres over HTTP and RLS decides every row.
- **`src/domain/` imports nothing.** No I/O, no React, no `react-native` — a boundary test
  enforces it. That is what lets the game rules run in a millisecond test suite, in the
  client, and inside a Deno edge function.
- **A written design system**, and the reasoning for it —
  [tokens, components, motion, and a rule against ever ranking anyone](docs/Windowbox%20mobile%20application%20design/FRONTEND_DESIGN.md).
- **Decisions are recorded** in [`docs/adr/`](docs/adr), and the commit history explains
  *why* rather than what.

## Stack

| | |
|---|---|
| **Client** | Expo (React Native) + Expo Router, one codebase for iOS, Android and web |
| **Database** | Supabase Postgres — RLS on every table, `pg_cron`, Vault |
| **Auth** | Supabase Auth. Google on web; magic link and Apple are built and dormant |
| **Server logic** | 5 Deno edge functions: sharpening, push fan-out, digests, wrapped, dev sign-in |
| **Hosting** | Cloudflare Pages, deployed from GitHub Actions after the suites pass |
| **Tests** | Vitest (domain + client), pgTAP (schema, RLS, RPCs), Vitest over HTTP (integration) |

## Quick start

Requires **Node 22** and Docker.

```sh
git clone https://github.com/DerekHertz/family-bingo.git
cd family-bingo
npm ci

cp .env.example .env          # then fill in your Supabase URL and anon key
npx supabase start            # local Postgres, Auth, Storage, PostgREST
npm run db:test               # pgTAP assertions
npm start                     # Expo — press w for web, i for the iOS simulator
```

To look at a real board without clicking through a whole year:

```sh
node scripts/seed-sealed-board.mjs   # one sealed board, all five growth stages
```

## Tests

```sh
npm test                  # domain + client. No Docker, milliseconds
npm run db:test           # pgTAP. Needs `npx supabase start`, and a `db reset` first
npm run test:integration  # HTTP, against the running local stack
npx tsc --noEmit
```

`npm run test:integration` seeds rows, and several pgTAP suites pick a family with
`limit 1` — so run `npx supabase db reset` **between** them or a batch of assertions fail
for reasons unrelated to your change.

## Architecture

```
src/domain/   pure game logic, no I/O — shared by client, server and tests
src/ui/       pure geometry, no React (the sunflower, the line through a bingo)
theme/        design tokens — the only source of colour, size and duration
lib/          the I/O boundary: supabase client, auth, session, queries/
components/   reusable, no data fetching
app/          expo-router routes; screens compose the above
supabase/     migrations, pgTAP suites, edge functions
```

The one rule that matters: **`src/domain` imports nothing but its own siblings.**
`src/domain/boundaries.test.ts` enforces it. One `react-native` import in there and both
the domain suite and the edge function bundles stop working.

## Platforms

The web app is what's deployed and linkable today. `eas.json` and `app.json` are already
set up for iOS and Android — the same Expo codebase runs on both — but neither has a
published build in any app store. Mobile is a possible future target, not a current one; the
build and signing steps live in [`docs/deploy.md`](docs/deploy.md#running-it-on-a-phone) if
that changes.

## Documentation

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | The glossary. Every domain word, and the words not to use |
| [`docs/prd.md`](docs/prd.md) | Product requirements, as 21 vertical slices |
| [`docs/schema.md`](docs/schema.md) | The data model and its invariants |
| [`docs/api.md`](docs/api.md) | RPCs, edge functions, and what the client may call |
| [`docs/adr/`](docs/adr) | Decision records — why personal boards, why RLS, why photos are risky |
| [`docs/deploy.md`](docs/deploy.md) | Standing up a Supabase project, the CI/CD pipeline, the public demo, and running a build on a phone |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | State of play, and every trap that has already cost time |
| [Design system](docs/Windowbox%20mobile%20application%20design/FRONTEND_DESIGN.md) | Tokens, components, motion, accessibility, and a list of things never to build |

## Contributing

It is a family project, so there is no roadmap to sign up to — but the traps are all written
down in [`docs/HANDOFF.md`](docs/HANDOFF.md), and issues and PRs are welcome. `main` is
protected: every change goes through a pull request and the CI gate has to be green. A few
constraints are load-bearing rather than incidental — no ranking or leaderboard
([ADR-0001](docs/adr/0001-personal-boards.md)), no streaks or enforced pace
([ADR-0002](docs/adr/0002-cumulative-goals-only.md)), and every RLS policy needs a negative
test proving another family gets zero rows
([ADR-0004](docs/adr/0004-supabase-rls-boundary.md)).

## License

[MIT](LICENSE). The two typefaces are SIL Open Font License 1.1 and are bundled under
[`assets/fonts/`](assets/fonts) with their licence text.
