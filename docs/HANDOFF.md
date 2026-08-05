# Handoff — where the build is, and how it is being built

Written at the end of the session that built the server and the first five client slices.
Read [`../CONTEXT.md`](../CONTEXT.md) and [`prd.md`](prd.md) first; this file is only the
state of play and the working rhythm.

---

## State

**Server: complete.** All 21 slices of [`prd.md`](prd.md) are built, merged to `main`, and
deployed to the live Supabase project — 31 migrations applied, 4 Edge Functions deployed,
verified end to end (`select * from edge_wiring_status()` returns HTTP 2xx).

**Client: slices 1–9 merged.** Slice 10 is in progress on `slice-10-seal`; 11–21 remain.

| Slice | Client status |
|---|---|
| 1 Sign in | Merged. Three passwordless routes; magic link is the one that works with no provider setup |
| 2 Create a Family | Merged |
| 3 Invite and approve | Merged. Both gates, seat pips, roster, `pending_memberships()` |
| 4 Child profiles | Merged. §4.7 contract before the button |
| 5 Open a Year | Merged |
| 6 Write a Goal | Merged. Drafting table + compose screen; `sharpened_at` added in slice 7 |
| 7 Sharpening | Merged. Save-then-ask, two equal cards, one sharpen per Goal |
| 8–9 The Centre | Merged. Mode vote, Goal vote, proposals, Organizer tiebreak |
| 10 Seal | Merged. The Board gets drawn, and has now been **looked at** in the Simulator |
| 11 Log an Increment | Merged. Tile sheet, optimistic one-tap, delete; sealed Boards get a readable goal list |
| 12 Complete a Tile | Merged. "We did it" for the Family Goal; the celebration gated on the Milestone |
| 13–21 | **Not started** |

Suites: **453 Vitest · 817 pgTAP · 19 integration**, `tsc` clean. All three must pass
before a merge.

### Where slice 10 got to

The server half (`seal_year`, `seal_due_boards`, the `pg_cron` job) shipped with the
server. The client half is **the Board being drawn**, because §4.1 says authoring is a
list and "the board isn't drawn until it seals" — so sealing is the moment twenty-four
sentences become a grid.

What shipped:

- `components/Sunflower.tsx` — 8 `View` petals + disc, memoised, all geometry from the
  already-tested `src/ui/sunflower.ts`
- `components/TileGrowth.tsx` — the five growth stages of §2 as a picture, taking a stage
  and a progress, including the leaf positioned against the *stem* rather than the tile,
  and completion's four cues (§6 A2: fill, silhouette, check, hatch). Slice 11's
  `<TileSheet>` should render **this**, not a second copy of the arithmetic
- `components/Tile.tsx` — the square: ground, border, one label, tap target
- `components/LinePips.tsx` — the 12-segment row; §13 puts it on the Family screen too
- `components/Board.tsx` — 5×5, never scrolls, from `rowsOf()` in the domain
- `app/board/[id].tsx` branches: sealed renders the grid, a draft renders the list
- `useTileCounts` — `COUNT(increments)` per Tile, never denormalised (§11.4), paged

Rendered and checked in the Simulator against a seeded Board (see *Looking at a screen*).
Tapping a Tile is deliberately inert and the squares render **non-interactive** because of
it — the TileSheet and one-tap logging are slice 11.

Four things the review caught here are worth carrying forward, because three of them are
shapes that will recur:

- **The shared Centre takes no Increments.** `tile_is_loggable()` refuses them: a Family
  Goal has no Target and is *marked done* (§12.3). Anything deriving Centre progress from
  `COUNT(increments)` answers 0 forever — which silently made the four Lines through the
  Centre, and Blackout (§13.3), unreachable. Read `family_goals.completed_at`.
- **PostgREST truncates at `max_rows = 1000` and says nothing.** Any `select` that can
  return more than a thousand rows has to page. `goals.target` has no upper bound.
- **Percentage widths cannot lay out a 5-across grid.** React Native has no `calc()`, so
  five children at `20%` plus four gaps overflow the row and the fifth wraps — the Board
  rendered 4 across for two commits without anything failing. Use rows of `flex: 1`.
- **A container `accessibilityLabel` without `accessible` never announces**, and adding
  `accessible` collapses the subtree on iOS, taking every child label with it.

```sh
npm test                  # pure layers — milliseconds, no Docker
npm run db:test           # pgTAP (needs npm run db:start)
npm run test:integration  # HTTP, against the running local stack
npx tsc --noEmit
```

---

## The working rhythm the user asked for

One slice per PR, flat off `main` — **never a stack.** A nine-deep stack was tried and had
to be unwound; a squash merge rewrites `main`, so every branch above it needs a rebase and
GitHub closes any PR whose base branch is deleted.

Per slice, without stopping to ask between them:

1. Build it. Read the PRD slice **and** the matching FRONTEND_DESIGN section.
2. `tsc` + all three suites green.
3. Open the PR.
4. **Dispatch a review agent** over `git diff main..<branch>`, briefed with the specs.
5. Fix what it finds. Push.
6. Squash merge, delete the branch, move on.

The reviews are not ceremony — they have caught a cross-Account data leak, a nine-month
lockout, a dead RPC, and several silent failures. Brief them hard: name the spec sections,
name the migration file with the real RPC signature, and ask them to check call sites
against it.

**Keep summaries short.** The user has said so explicitly.

---

## Environment

- **Node 22 is required** (Expo SDK 57 needs ≥20.19; 21.x lacks `util.parseEnv`). It is
  Homebrew keg-only, so `export PATH="/usr/local/opt/node@22/bin:$PATH"` has to be set by
  hand — and it lives in **`~/.zshenv` and `~/.zprofile`**, not `~/.zshrc`. Both are
  needed: `.zshrc` is read only by *interactive* shells, so a tool or script running a
  command through a non-interactive zsh got 21.x; and `.zprofile`'s `brew shellenv`
  prepends `/usr/local/bin`, where 21.x lives, so in a login shell the export has to come
  *after* it. Getting this wrong fails confusingly rather than loudly.
- `babel.config.cjs`, not `.js` — `package.json` declares `"type": "module"` for the
  domain layer.
- `.env` holds `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; it is
  gitignored. `.env.example` is the template.
- **The iOS Simulator works on this machine** as of 2026-08-04. Xcode 26.3 is installed at
  `/Applications/Xcode.app` and the iOS 26.3 runtime still ships `x86_64`, so it runs on
  this Intel Mac — check with
  `xcrun simctl list runtimes -j | python3 -c "import json,sys; print(json.load(sys.stdin)['runtimes'][0]['supportedArchitectures'])"`
  before assuming a future runtime does. `npx expo start --ios` boots Expo Go in it.
  **The assistant can now see the app** via `xcrun simctl io booted screenshot`, which is a
  change from every previous session — the user no longer has to be the eyes.
  Expo Go on the user's iPhone 15 (iOS 26.6) and `--web` remain the other two previews.
- **Two real Accounts exist on the live project for testing**: `derekhertzell@gmail.com`
  and `ithertzalot@gmail.com`. They are what anything needing two people — an Invitation,
  an approval, a Centre vote, a shared Family Goal — has to be exercised with, and they are
  why `dev-login` exists (the default SMTP sends two emails an hour). See open item 1b:
  `ithertzalot` has a Board in 2027 but not 2026.
- **Expo Go must match the SDK exactly.** SDK 57 needs Expo Go **57.0.6** (iOS) /
  **57.0.3** (Android); an older client refuses with *"Project is incompatible with this
  version of Expo Go"*. An in-place App Store update can sit pending — deleting and
  reinstalling Expo Go is the reliable fix. `expo-dev-client` is deliberately NOT a
  dependency: installing it flips `expo start` into dev-build mode, which is the wrong
  default while Expo Go is the working route.
- **iOS signing:** a free Apple ID works via local Xcode (`npx expo run:ios --device`,
  7-day expiry, needs `expo prebuild`). EAS **cloud** builds need the paid $99/yr
  programme, because ad-hoc profiles come from the Developer Program API. Android needs
  no account at all. `eas.json` is set up for all of it.
- **Two duplicated-dependency traps have already bitten.** `react-native-screens` was
  installed twice at different versions, which Expo Go cannot load at all; `expo-doctor`
  catches this class and is worth running whenever the device build misbehaves.

---

## Looking at a screen, end to end

The whole loop, with no email and no live data:

1. `npx supabase start`, then `npx supabase functions serve --env-file supabase/.env`
   (that file holds `DEV_LOGIN_SECRET`; **it must be ≥32 characters** or `dev-login`
   answers a flat `not_found`, which is the same answer it gives a wrong secret).
2. `.env.local` — gitignored, and Expo loads it *ahead of* `.env`, so it redirects the app
   at the Docker stack without touching the live config. Delete it to go back.
3. `node scripts/seed-sealed-board.mjs` — one sealed Board carrying all five growth stages,
   two unfilled Tiles (§10.2), a shared Centre and one complete row. It prints the ids.
   Idempotent, and **only ever run against local**: sealing is irreversible (§10.3), so
   this must never be pointed at the live project.
4. `npx expo start --ios`.
5. Sign in with **no taps**: mint a session with the password grant and deep-link it into
   `/auth/callback`. Two details, both of which cost time:

   - **The query string, not the fragment.** Expo Go drops the fragment, and the callback
     then spins forever on a URL that never arrives — which looks exactly like a hung
     network call.
   - **`127.0.0.1`, not the LAN IP.** Metro prints whatever address it bound to and that
     changes with the network; the simulator shares the host's stack, so localhost always
     works and the printed one sometimes does not.

   ```sh
   xcrun simctl openurl booted \
     "exp://127.0.0.1:8081/--/auth/callback?access_token=$AT&refresh_token=$RT"
   ```
6. Navigate the same way: `exp://127.0.0.1:8081/--/board/<id>`.

Two traps that cost time here:

- **`npm run db:test` needs a clean database.** Several suites do
  `select id from families limit 1`, so *any* seeded row makes them pick the wrong Family
  and ~20 tests fail for reasons that have nothing to do with the change. Run
  `npx supabase db reset` before pgTAP, and re-seed after.
- **`simctl` cannot tap.** Screenshots are free, but synthesising a touch needs a `CGEvent`
  post — System Events' `click at` answers `-25204` against the Simulator — and the host
  process needs Accessibility permission. Prefer deep links over taps wherever a route
  accepts one.

---

## Architecture, and the one rule that matters

```
src/domain/   pure logic, no I/O — shared by server, client, and a millisecond test suite
src/ui/       pure geometry, no React (the sunflower)
theme/        tokens + font resolution — the only source of colour, size, duration
lib/          I/O boundary: supabase client, auth, session, queries/
components/   reusable, no data fetching
app/          expo-router routes; screens compose the above
supabase/     migrations, pgTAP, Edge Functions
```

**`src/domain` imports nothing but node builtins and its own siblings.**
`src/domain/boundaries.test.ts` enforces it, including `import()` and `require()`. This is
not style: one `react-native` import in there and the domain suite stops running and the
Edge Functions stop bundling. It has already happened once.

**Never spread a raw `type` token.** Use `styles` from `theme/fonts.ts`. A raw token names
the design system's family, which the renderer has never loaded, so the text silently falls
back to the system font. `theme/fonts.test.ts` greps for the mistake.

---

## Traps that have already cost time

- **`react-query` keys must carry the Account id**, and `SIGNED_OUT` must
  `queryClient.clear()`. A bare key served the previous Account's data after a sign-out,
  with `staleTime` suppressing the refetch that would have corrected it.
- **`members_read` is Family-wide.** Any query against `members` that means "the caller"
  needs `.eq('account_id', …)`, or it returns every Member of every visible Family.
- **RPC arg names fail at runtime, not compile time.** Check every call against the
  migration.
- **A `disabled` gate built from data a role cannot read will lie.** Non-Organizers cannot
  read `invitations`, so any seat count derived from them under-counts.
- **Expo typed routes** reject links to screens that do not exist yet. Do not ship a button
  to an unbuilt route; leave it out and say so in the PR.
- **zsh globs `[id].tsx`** — write route files with the file tool, not a heredoc.
- **PostgREST rejects with a plain object, not an `Error`.** `e instanceof Error` is
  false, so `e.message` reads `''` and every message branch silently dies — four screens
  shipped that way and answered every failure with "have another go in a moment". Use
  `lib/failure.ts`, and match on `code` (the SQLSTATE) rather than the message text,
  because `PT403`/`PT409` never appear in the message.
- **`router.back()` assumes a history that often is not there** — any route can be first
  on web, and a magic link is a deep link. Use `leaveTo(fallback)` from `lib/leave.ts`.
- **`controlled_member_ids()` is not Family-scoped.** Somebody in two Families is two
  Members and both match `account_id`, so a client-side reproduction of it needs
  `.eq('family_id', …)` as well — otherwise a screen can act as the wrong Member and
  every write is refused by a guard that cannot explain itself.
- **RPC argument names are now guarded** by `lib/rpc-signatures.test.ts`, which checks
  every `supabase.rpc()` call site against the migrations and fails on any call it cannot
  parse. Write the function name as a literal; a name behind a helper is invisible to it.

---

## Open items, none blocking

0. **Positions are never dealt at seal, and §4.1 says they are.** *"The list stays in the
   order written; positions are dealt at seal, so no Member can place the easy one in a
   corner."* No migration implements it — `write_goal()` writes to whichever Tile is open
   and "Write another" fills the lowest empty position, so **the board is exactly write
   order**, first Goal top-left. The rule against stacking a diagonal with the three
   easiest Goals is simply absent. Fix belongs inside `seal_year()` so it is idempotent
   and re-runnable (§10.4): shuffle the 24 authorable positions, leave the Centre at 12,
   move `position` only — Increments follow the Tile, not the square. **This is the next
   slice**, agreed with the user 2026-08-04.
0a. **§3's increment verb is underdetermined.** It asks for a verb "phrased from the goal's
   unit" and gives *"Walked one"*, *"Read one"*, *"Did it"* — but §7.10 makes
   `unit_canonical` a singular **noun** (`"book"`), and nothing turns "book" into "read".
   `src/domain/increment.ts` uses a short table of irregulars with a safe fallback, and
   deliberately never puts the Member's own (usually plural) wording after "one". The
   document should say what the rule is; this belongs with the §4.2 contradictions below.
1. **`docs/api.md` §2.2 lists a `digest` Edge Function that does not exist.** The outbox
   made it redundant and `notify` sends digests. Worth deleting the row.
1a. **Two spec contradictions worth settling**, both found while building §4.2/§4.3:
   FRONTEND_DESIGN §4.2 asks for both "One call per Goal, no reroll" *and* a "Sharpen it
   again" row; and PRD §7's acceptance test says "2–3 alternatives are returned" while
   §4.2 says one, never a menu. Both were resolved toward the prose rule (no reroll after
   success; one suggestion) — the documents should be corrected so the next reader does
   not undo it.
1b. **`ithertzalot` has no Board in the 2026 Year**, only 2027 — they were approved after
   2026 opened, and the late-joiner trigger dealt them a Board on the Year current at
   that moment. Slice 21's territory, but it means the 2026 Centre has a voter with
   nowhere to write goals.
2. **"Wrapped" is flagged in FRONTEND_DESIGN §8** as strongly associated with another
   company's product, suggesting *The Almanac*. Slice 4's copy already says "Almanac" while
   the codebase says "Wrapped" — inconsistent, and cheap to settle now rather than after it
   is in forty files.
3. **CI/CD** — discussed, not built. First move is a GitHub Action running `tsc` + Vitest on
   every PR; pgTAP needs a Supabase service container.
4. **Apple and Google sign-in are not configured** on the Supabase project, so those buttons
   return "isn't set up for this project yet". Magic link works — but the default SMTP
   sends **two emails an hour**, which is not enough to test anything involving two people.
   `supabase/functions/dev-login` is the way round it and the README explains it. It is a
   back door gated on `DEV_LOGIN_SECRET`; unset the secret to close it, and never set it on
   a project holding real data.
5. **A magic-link Account's `display_name`** falls back to the email local part. Editing it
   belongs to §4.6's Account screen, which is unbuilt.
6. **Web sessions use `localStorage`** and the module throws on any non-localhost origin.
   Revisit if web ever becomes a real target.

---

## Deploying

See [`../README.md`](../README.md) → "Deploying to a Supabase project". The two Vault
secrets and the Edge Function secret are already set on the live project; a new project
needs them again.
