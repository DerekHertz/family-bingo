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
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **Where the build is**, the per-slice rhythm, and the traps that have already cost time |

## Stack

Expo (React Native) + TypeScript · Supabase (Postgres + Auth + Storage + Edge Functions +
`pg_cron`) · `claude-opus-5` for goal Sharpening.

## Deploying to a Supabase project

Four steps, and only the first three need a human. Run them once per project.

```sh
supabase login                      # opens a browser
supabase link --project-ref <ref>   # the subdomain of your project URL
supabase db push                    # applies every migration in supabase/migrations
supabase functions deploy           # notify · reap-attachments · sharpen · wrap
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

A "Sign in without the email (dev)" row appears under the email field. Type either
address, tap it, and you are that Account.

**This is a back door, and that secret is the only thing standing in it.** Do not set
`DEV_LOGIN_SECRET` on a project holding anyone's real data. To close it, delete the
secret — the function goes inert and answers 404 to everyone, with nothing to redeploy:

```sh
supabase secrets unset DEV_LOGIN_SECRET
```

The first Account for each address still has to be made the ordinary way, once: the
function looks an address up and never creates one.

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
