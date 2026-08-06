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

> **Status:** complete and deployed as a web app. Sign-up is **invite-only** while it is
> being tested with real families — the live link opens a read-only demo that needs no
> account. Native iOS and Android builds are configured but not published.

---

## The loop

Write 24 goals in December → the board **seals** on 1 January → log progress all year →
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
  different family gets **zero rows** — not an error, zero rows
  ([ADR-0004](docs/adr/0004-supabase-rls-boundary.md)). There is no API server: the client
  talks to Postgres over HTTP and RLS decides every row.
- **900+ pgTAP assertions** run against a real Postgres, alongside 758 unit tests and 24
  HTTP integration tests. The highest-consequence of them checks that a photo of somebody's
  child cannot be fetched by a wrong-family token from a real object URL (PRD §16.5).
- **`src/domain/` imports nothing.** No I/O, no React, no `react-native` — a boundary test
  enforces it, including through `import()` and `require()`. That is what lets the game
  rules run in a millisecond test suite, in the client, and inside a Deno edge function.
- **A written design system**, and the reasoning for it. Twelve lines, five growth stages,
  one accent colour reserved for progress and one for family, and
  [a rule against ever ranking anyone](docs/Windowbox%20mobile%20application%20design/FRONTEND_DESIGN.md).
- **Decisions are recorded** in [`docs/adr/`](docs/adr), and the commit history explains
  *why* rather than what.

## Stack

| | |
|---|---|
| **Client** | Expo (React Native) + Expo Router, one codebase for iOS, Android and web |
| **Database** | Supabase Postgres — 38 migrations, RLS on every table, `pg_cron`, Vault |
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
npm run db:test               # 900+ pgTAP assertions
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
`limit 1` — so run `npx supabase db reset` **between** them or ~30 assertions fail for
reasons unrelated to your change.

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

## Documentation

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | The glossary. Every domain word, and the words not to use |
| [`docs/prd.md`](docs/prd.md) | Product requirements, as 21 vertical slices |
| [`docs/schema.md`](docs/schema.md) | The data model and its invariants |
| [`docs/api.md`](docs/api.md) | RPCs, edge functions, and what the client may call |
| [`docs/adr/`](docs/adr) | Decision records — why personal boards, why RLS, why photos are risky |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | State of play, and every trap that has already cost time |
| [Design system](docs/Windowbox%20mobile%20application%20design/FRONTEND_DESIGN.md) | Tokens, components, motion, accessibility, and a list of things never to build |

## Contributing

It is a family project, so there is no roadmap to sign up to — but the traps are all written
down in [`docs/HANDOFF.md`](docs/HANDOFF.md), and issues and PRs are welcome. `main` is
protected: every change goes through a pull request and the CI gate has to be green.

## License

[MIT](LICENSE). The two typefaces are SIL Open Font License 1.1 and are bundled under
[`assets/fonts/`](assets/fonts) with their licence text.

---

## Deploying to a Supabase project

Four steps, and only the first three need a human. Run them once per project.

```sh
supabase login                      # opens a browser
supabase link --project-ref <ref>   # the subdomain of your project URL
supabase db push                    # applies every migration in supabase/migrations
supabase functions deploy           # notify · reap-attachments · sharpen · wrap
```

With no function named, `deploy` deploys **everything** in `supabase/functions/` — which
now includes `dev-login`, a back door that stays inert until a secret is set. It is
harmless deployed and unconfigured, and that is the design, but see "Testing with two
accounts" below before setting that secret. To leave it off a project entirely, add this
to `supabase/config.toml` and it is skipped by both `deploy` and `serve`:

```toml
[functions.dev-login]
enabled = false
```

**1. The Claude API key** is an *Edge Function secret*, not a shell variable — a local
`export` is invisible to a deployed function:

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

**2. Two values go in Vault**, in the SQL editor. `alter database ... set` is denied on
Supabase — the SQL editor's role is not superuser — and a database setting would survive
neither a project restore nor a branch. Vault survives both.

```sql
select vault.create_secret('<service-role-key>', 'service_role_key');
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_url');
```

**The key must be the `service_role` JWT** — the long `eyJ...` string — not a
`sb_secret_...` key. Edge Functions run with `verify_jwt` on, so the bearer token has to
be a JWT signed by the project; a secret key is not one and the call comes back 401.

To replace a value, delete first — `create_secret` refuses a duplicate name:

```sql
delete from vault.secrets where name = 'service_role_key';
```

Until both are set, `invoke_edge_function()` returns quietly and **the cron-driven
functions do nothing** — deliberately, so local development and tests stay green without a
live project behind them.

**4. Nothing to do.** The Database Webhook that drains the push outbox within seconds is
a trigger in `20260801000030_edge_invocation.sql`, applied by `db push`. Do not also
create one in the dashboard — you would get two.

### Checking it works

Every failure in this pipeline is silent: an unset secret returns null, and a rejected
request fails inside pg_net's background worker where nothing surfaces it. Together that
is a push system which looks healthy and notifies nobody. One query answers it:

```sql
select invoke_edge_function('notify');   -- fire one request
select * from edge_wiring_status();      -- then read the verdict
```

`service_role_key` should report **"looks like a JWT — correct kind"**; anything else means
the wrong key. `last request` should report **HTTP 2xx** — a 401 is almost always a
`sb_secret_...` key where the `service_role` JWT belongs.

```sql
select jobname, schedule from cron.job;  -- 5 jobs: seal, digest, freeze, reap, drain
```

### Testing with two accounts

Supabase's default SMTP sends **two emails an hour**. Anything that takes two people — an
Invitation, an approval, a Centre vote — spends that in the first minute, and then the
project is unusable until the hour turns.

`dev-login` is the way round it. It exchanges an email address for a session against an
Account **that already exists**: no email, no rate limit, and the client finishes with the
same `verifyOtp` call a real magic link makes, so nothing downstream can tell them apart.

```sh
supabase secrets set DEV_LOGIN_SECRET=$(openssl rand -hex 32)   # note the value
supabase functions deploy dev-login
echo 'EXPO_PUBLIC_DEV_LOGIN_SECRET=<that same value>' >> .env   # then restart Expo
```

Tap "Email me a link instead", and a "Sign in without the email (dev)" row sits under the
email field. Type either address, tap it, and you are that Account.

`EXPO_PUBLIC_SUPABASE_ANON_KEY` has to be the **`eyJ...` anon JWT**, not a
`sb_publishable_...` key. Edge Functions run with `verify_jwt` on, so the gateway checks
the bearer token before the function is reached and a publishable key comes back 401 —
the same trap as the Vault key above, one layer out.

**This is a back door, and that secret is the only thing standing in it.**

- Do not set `DEV_LOGIN_SECRET` on a project holding anyone's real data.
- Do not distribute a build with `EXPO_PUBLIC_DEV_LOGIN_SECRET` set. It is inlined into
  the bundle, and `expo start --web` serves that bundle on every interface — anyone on the
  same network can read it.

To close it, delete the secret. The function goes inert and answers 404 to everyone, with
nothing to redeploy:

```sh
supabase secrets unset DEV_LOGIN_SECRET
```

The first Account for each address still has to be made the ordinary way, once: the
function looks an address up and never creates one.

## Continuous integration, and the web deploy

Four workflows in [`.github/workflows/`](.github/workflows). Each one carries its own
reasoning in comments; this is the map and the list of things a human has to create.

| Workflow | When | What |
|---|---|---|
| `ci.yml` | Every PR, every push to `main` | `tsc`, the Vitest suites, an `expo export --platform web`, and — only when `supabase/**` or `lib/queries/**` change — the pgTAP and integration suites against a real local stack |
| `deploy.yml` | After CI goes green on `main` | Rebuilds the web bundle with the live project's values and publishes `dist/` to Cloudflare Pages |
| `health.yml` | Every 2 days | Hits the Supabase API and the deployed site, and fails loudly if either is down |
| `backup.yml` | Weekly | `pg_dump` of the live database, gzipped, kept as a 90-day artifact |

**Require only `gate` in branch protection.** It is a job in `ci.yml` that exists solely to
answer for the other four. Requiring `database` directly would make every PR that does not
touch SQL unmergeable: a skipped job reports no conclusion at all, so GitHub shows the
required check as "waiting for status to be reported" and waits forever.

### Secrets

**Settings → Secrets and variables → Actions → Secrets.**

| Secret | Used by | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `deploy` | Cloudflare → My Profile → API Tokens → Create Token → the **"Edit Cloudflare Workers"** template, or a custom token with `Account · Cloudflare Pages · Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy` | Cloudflare → Workers & Pages → right-hand sidebar, or the hex string after `/accounts/` in the dashboard URL |
| `EXPO_PUBLIC_SUPABASE_URL` | `deploy`, `health` | Supabase → Project Settings → Data API → Project URL. The same value as your `.env` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `deploy`, `health` | Supabase → Project Settings → API Keys → the **`anon` `eyJ...` JWT**, not a `sb_publishable_...` key — see "Testing with two accounts" above for why the publishable key comes back 401 |
| `SUPABASE_DB_URL` | `backup` | Supabase → Connect → **Session pooler**, with the database password substituted in |

The session pooler matters and the other two connection strings both fail. The direct
`db.<ref>.supabase.co` host is IPv6-only and GitHub's runners have no IPv6 route; the
transaction pooler on port 6543 holds no session, which `pg_dump` needs for its snapshot.

**Variables** (same page, Variables tab) — neither is a secret, and masking a public URL
only makes failures harder to read:

| Variable | Value |
|---|---|
| `SITE_URL` | The deployed origin, e.g. `https://family-bingo.pages.dev`. Unset means `health` skips the site half |
| `CLOUDFLARE_PAGES_PROJECT` | The Pages project name. Defaults to `family-bingo` |

**`EXPO_PUBLIC_DEV_LOGIN_SECRET` must never be added to any of them.** It is the whole of
the `dev-login` back door, and `EXPO_PUBLIC_*` is not a namespace for configuration — it is
Expo's instruction to inline the literal into the bundle. `deploy.yml` publishes that
bundle to the open web, so the secret would be readable with view-source. This is the same
rule that keeps it out of `eas.json`, one deployment target further out.

### What the deploy ships

`public/_redirects` and `public/_headers` are copied verbatim into `dist/` by
`expo export --platform web`, which does not mention them in its own summary — so
`deploy.yml` asserts they arrived rather than trusting it.

`_redirects` is the SPA fallback. Expo Router exports a single `index.html` and routes on
the client; without `/*  /index.html  200` every deep link — a magic-link callback, a
notification's `/board/<id>` — is a Cloudflare 404. `_headers` carries the CSP and the
transport headers; the comments in it explain why `style-src` cannot drop `'unsafe-inline'`
and what would break `script-src 'self'`.

### The two scheduled jobs, and what they are really for

The Supabase project is on the free tier. **It pauses after 7 days of no activity** and
needs a human to restore it, which presents as a working site where nothing loads — worse
than a site that is plainly down. `health.yml` is the traffic that prevents it. Note that
**GitHub disables scheduled workflows in a repository with 60 days of no activity**, which
is exactly the state a finished project reaches, so if it stops running re-enable it from
the Actions tab.

The free tier also has **no restorable backup**, which makes `backup.yml` the one guarding
the failure with no recovery path. Read the comment at the top of it before relying on it:
the dump holds rows, not the project. The photographs are not in it — Storage objects live
in S3 — and neither are the Edge Function secrets, the Vault entries, or the `pg_cron`
schedules. Restoring is `supabase db push` for the schema and then the data, not
`psql < dump.sql`. Worth rehearsing once on a throwaway project.

## Running it on a phone

`npx expo start` and Expo Go is the quickest route, but Expo Go only runs the **one** SDK
its App Store build was compiled against — SDK 57 needs Expo Go **57.0.6** (iOS) or
**57.0.3** (Android), and an older one refuses with *"Project is incompatible with this
version of Expo Go"*. That coupling is permanent; it breaks again on every SDK bump.

A **development build** is the same app with this project's own native modules baked in,
so the SDK question goes away for good. `eas.json` is set up for it:

```sh
npm install -g eas-cli          # or use npx
eas login                       # opens a browser
eas build --profile development --platform android   # ~10 min, produces an APK
```

Install the result and run `npx expo start --dev-client`. The dev build connects to Metro
exactly like Expo Go, with fast refresh unchanged.

Install the result and run `npx expo start --dev-client`.

**On iOS, a free Apple ID is enough — but only locally.** The distinction is where the
signing happens, not what you are allowed to run:

| Route | Account | Notes |
|---|---|---|
| Expo Go | none | Only ever runs the SDK its store build was compiled against |
| `npx expo run:ios --device` | **free Apple ID** | Xcode signs with a personal team. Expires after **7 days**, then re-run it. Needs `npx expo prebuild` and Xcode (~15 GB) |
| `eas build --platform ios` | **paid, $99/yr** | Ad-hoc profiles come from the Developer Program API; EAS cannot use a personal team |
| `eas build --platform android` | none | APK sideloads |

So EAS is the paid path and Xcode is the free one. On an **Intel** Mac check which Xcode
the App Store actually offers before committing to the download — Xcode's newest releases
have dropped Intel, and React Native 0.86 wants a recent one.

**`expo-dev-client` is deliberately not a dependency.** Installing it flips
`npx expo start` into dev-build mode, which is the wrong default while Expo Go is the
route that works. `eas build` adds what it needs at build time; install it locally only
once you have a dev build to run.

### Two things that will bite

**EAS does not read `.env`.** `EXPO_PUBLIC_*` values are inlined at build time from the
machine doing the build, and that machine is in the cloud. So the Supabase URL and anon
key live in `eas.json` under each profile's `env`. Both are public by design — the anon
key authorizes nothing on its own, RLS decides every row (ADR-0004), and both ship inside
every bundle regardless.

**`EXPO_PUBLIC_DEV_LOGIN_SECRET` is deliberately not in `eas.json`.** It is the only value
here that is a real credential, and a committed file is the wrong place for it. A dev build
therefore has no dev sign-in row, which is the right default for a build you might hand to
somebody. To include it in your own builds:

```sh
eas env:create --name EXPO_PUBLIC_DEV_LOGIN_SECRET --value <the secret> --environment development
```

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
