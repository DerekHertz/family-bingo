# Handoff — where the build is, and how it is being built

Read [`../CONTEXT.md`](../CONTEXT.md) and [`prd.md`](prd.md) first; this file is only the
state of play, the working rhythm, and the traps that have already been paid for.

---

## State

**Server: complete**, and no longer only the server. All 21 slices of [`prd.md`](prd.md)
are built. 36 migrations, 5 Edge Functions.

**Client: complete through slice 21.** Every slice has a client half.

| Slice | Status |
|---|---|
| 1 Sign in | Merged. Three passwordless routes; magic link is the one that works with no provider setup |
| 2 Create a Family | Merged |
| 3 Invite and approve | Merged. Both gates, seat pips, roster, `pending_memberships()` |
| 4 Child profiles | Merged. §4.7 contract before the button |
| 5 Open a Year | Merged |
| 6 Write a Goal | Merged. Drafting table + compose screen |
| 7 Sharpening | Merged. Save-then-ask, two equal cards, one sharpen per Goal |
| 8–9 The Centre | Merged. Mode vote, Goal vote, proposals, Organizer tiebreak |
| 10 Seal | Merged. The Board gets drawn |
| 11 Log an Increment | Merged. Tile sheet, optimistic one-tap, delete |
| 12 Complete a Tile | Merged. "We did it"; the celebration gated on the Milestone |
| 13 Lines, Bingo, Blackout | Merged. Milestone-gated celebration, the drawn hairline, the Milestone card |
| 14 The Feed | Merged. Five row kinds, keyset paging, `mossTintEdge` |
| 15 Push notifications | Merged. Tokens, deep links, §4.8's switches, quiet hours |
| 16 Photos | Private bucket, short-TTL signed URLs, EXIF stripped on re-encode |
| 17 Offline logging | Persisted queue, Increments only, idempotent on the client uuid |
| 18 Swaps | Merged. Confirm sheet, budget pips, its own compose |
| 19 Account screen | Merged. §4.6's ordering, per-Family names, delete. The Digest opt-in shipped with 15 |
| 20 Freeze and Wrapped | Merged. Six cards, the Awards, the stats-only share |
| 21 Late joiners | Merged. The "joined July" marker, the personal-window note |

Suites: **758 Vitest · 879 pgTAP · 24 integration**, `tsc` clean. Run all three before a
merge — and note that `test:integration` seeds rows, so pgTAP needs a `db reset` **after**
it as well as before.

```sh
npm test                  # pure layers — milliseconds, no Docker
npm run db:test           # pgTAP (needs npm run db:start)
npm run test:integration  # HTTP, against the running local stack
npx tsc --noEmit
```

---

## The working rhythm

One slice per PR, flat off `main` — **never a stack.** A nine-deep stack was tried and had
to be unwound; a squash merge rewrites `main`, so every branch above it needs a rebase and
GitHub closes any PR whose base branch is deleted.

Per slice:

1. Build it. Read the PRD slice **and** the matching FRONTEND_DESIGN section.
2. `tsc` + all three suites green.
3. Open the PR.
4. **Dispatch a review agent** over the branch diff, briefed with the specs.
5. Fix what it finds. Push.
6. Squash merge, delete the branch, move on.

The reviews are not ceremony. Over slices 13–21 they caught: a Feed announcing the
opposite of what a vote decided; a confirm sheet promising the opposite of what the server
does; empty squares that could never be filled for a whole Year; last year's Almanac made
unreachable by the button that opens next year; a budget that failed open instead of shut;
a failed page erasing three hundred loaded rows; and two stacked modals that would have
shipped working on Android and broken on iOS. Brief them hard: name the spec sections, name
the migration with the real signature, and ask them to check call sites against it.

**Parallel agents work, with one rule.** Several slices were built concurrently in isolated
worktrees. The rule that made it survivable: give each agent an explicit *do-not-touch*
list naming the files other work is in flight in. The rebases were then small. Migration
numbers are the exception — two branches both claimed `…035`, which is a hard
`schema_migrations` collision rather than a cosmetic clash, so check `ls
supabase/migrations | tail -1` on `main` before numbering one.

**Keep summaries short.** The user has said so explicitly.

---

## Environment

- **Node 22 is required** (Expo SDK 57 needs ≥20.19; 21.x lacks `util.parseEnv`). It is
  Homebrew keg-only, so `export PATH="/usr/local/opt/node@22/bin:$PATH"` has to be set by
  hand — and it lives in **`~/.zshenv` and `~/.zprofile`**, not `~/.zshrc`. Both are
  needed: `.zshrc` is read only by *interactive* shells, so a tool running a command
  through a non-interactive zsh got 21.x; and `.zprofile`'s `brew shellenv` prepends
  `/usr/local/bin`, where 21.x lives, so in a login shell the export has to come *after*
  it. Getting this wrong fails confusingly rather than loudly.
- `babel.config.cjs`, not `.js` — `package.json` declares `"type": "module"`.
- `.env` holds `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; gitignored.
- **Expo typed routes reject a link to a route that does not exist yet**, and the generated
  types live in `.expo/types/router.d.ts`, which is gitignored. After adding a route file,
  regenerate them by running `npx expo start` until the route appears in that file, then
  killing it. A branch that links to another branch's route will typecheck locally on a
  stale file and fail on a clean checkout — which is why slice 19 waited for slice 15.
- **The iOS Simulator works on this machine.** Xcode 26.3, and the iOS 26.3 runtime still
  ships `x86_64` so it runs on this Intel Mac. `npx expo start --ios` boots Expo Go.
  Screenshots via `xcrun simctl io booted screenshot` — the assistant can see the app.
- **Two real Accounts exist on the live project for testing**: `derekhertz@gmail.com` and
  `ithertzalot@gmail.com`. They are what anything needing two people has to be exercised
  with, and they are why `dev-login` exists (the default SMTP sends two emails an hour).
- **Expo Go must match the SDK exactly.** SDK 57 needs Expo Go **57.0.6** (iOS) /
  **57.0.3** (Android). An in-place App Store update can sit pending — deleting and
  reinstalling is the reliable fix.
- **`expo-dev-client` is in the tree transitively**, via `expo-updates@57.0.11`. Nobody
  added it. It makes `expo start` print "a development build is not installed", but Expo Go
  still launches, so the preview route is intact. Worth knowing before chasing it.
- **iOS signing:** a free Apple ID works via local Xcode (7-day expiry, needs
  `expo prebuild`). EAS **cloud** builds need the paid programme. Android needs no account.

---

## Looking at a screen, end to end

1. `npx supabase start`, then `npx supabase functions serve --env-file supabase/.env`
   (that file holds `DEV_LOGIN_SECRET`; **it must be ≥32 characters** or `dev-login`
   answers a flat `not_found`, which is the same answer it gives a wrong secret).
2. `.env.local` — gitignored, and Expo loads it *ahead of* `.env`, so it redirects the app
   at the Docker stack without touching the live config. Delete it to go back.
3. `node scripts/seed-sealed-board.mjs` — one sealed Board carrying all five growth stages,
   two unfilled Tiles, a shared Centre and one complete row. Idempotent, and **only ever
   run against local**: sealing is irreversible (§10.3).
4. `npx expo start --ios`.
5. Sign in with **no taps**: mint a session with the password grant and deep-link it.
   - **The query string, not the fragment.** Expo Go drops the fragment, and the callback
     then spins forever on a URL that never arrives.
   - **`127.0.0.1`, not the LAN IP.** The simulator shares the host's stack.

   ```sh
   xcrun simctl openurl booted \
     "exp://127.0.0.1:8081/--/auth/callback?access_token=$AT&refresh_token=$RT"
   ```
6. Navigate the same way: `exp://127.0.0.1:8081/--/board/<id>`.

Two traps that cost time here:

- **`npm run db:test` needs a clean database**, and `npm run test:integration` is what
  dirties it. Several suites do `select id from families limit 1`, so *any* seeded row makes
  them pick the wrong Family and ~30 assertions fail for reasons unrelated to the change.
  Run `npx supabase db reset` before pgTAP — including after the integration suite.
- **`simctl` cannot tap.** Screenshots are free, but synthesising a touch needs a `CGEvent`
  post and Accessibility permission. Prefer deep links over taps wherever a route accepts
  one.

---

## Architecture, and the rules that matter

```
src/domain/   pure logic, no I/O — shared by server, client, and a millisecond test suite
src/ui/       pure geometry, no React (the sunflower, the drawn line)
theme/        tokens + font resolution — the only source of colour, size, duration
lib/          I/O boundary: supabase client, auth, session, queries/
components/   reusable, no data fetching
app/          expo-router routes; screens compose the above
supabase/     migrations, pgTAP, Edge Functions
```

**`src/domain` imports nothing but its own siblings.** `src/domain/boundaries.test.ts`
enforces it, including `import()` and `require()`. One `react-native` import in there and
the domain suite stops running and the Edge Functions stop bundling. It has happened once.

That test greps for import *syntax*, so a **comment** containing the words of an import
statement fails it. Phrase around it rather than fighting it.

**Never spread a raw `type` token.** Use `styles` from `theme/fonts.ts`. A raw token names
the design system's family, which the renderer has never loaded, so the text silently falls
back to the system font. `theme/fonts.test.ts` greps for the mistake.

**Say each thing once.** A twelve-point consolidation landed in `f067bd3`; the shared
pieces it produced are the ones to reach for rather than rebuild:

- `components/Screen.tsx` — `<Loading>`, `<Trouble>`, `<ErrorState>`, `<FormScreen>`
- `components/Field.tsx` — the single-line and compose fields
- `lib/announce.ts` — `useAnnounce()`, which is `say()` plus the live region
- `src/domain/member.ts` — `isControlledBy`/`isManaged`, mirroring `controlled_member_ids()`
- one `…FailureCopy(thrown)` per query module, matched on **SQLSTATE**, never message text

---

## Traps that have already cost time

- **`react-query` keys must carry the Account id**, and `SIGNED_OUT` must
  `queryClient.clear()`. A bare key served the previous Account's data after a sign-out.
- **`members_read` is Family-wide.** So are `boards_read`, `milestones_read`,
  `revisions_read`, `votes_read` and the `feed` view. Any query that means "the caller" or
  "this Board" has to say so itself; RLS is the boundary, not the scope.
- **RPC arg names fail at runtime, not compile time.** `lib/rpc-signatures.test.ts` checks
  every `supabase.rpc()` call site against the migrations. Write the function name as a
  literal; a name behind a helper is invisible to it.
- **PostgREST rejects with a plain object, not an `Error`.** `e instanceof Error` is false,
  so `e.message` reads `''`. Use `lib/failure.ts`, and match on `code`.
- **One SQLSTATE can cover four different refusals.** `swap_tile()` raises `PT403` for a
  draft Board, the shared Centre, a completed Tile and an exhausted budget; `write_goal()`
  raises it for two things. Discriminate **before** the request, from facts already in
  hand, not after it from message text.
- **A failed read must fail shut.** `swapsUsed: budget.data ?? 0` means *zero used*, which
  is a full budget — it offered three swaps to a Member who had spent all three.
- **`now()` is the transaction's clock.** One tap writes a `tile_completed`, up to four
  Lines and a Blackout with an identical `created_at`. Anything ordering on it needs a
  tiebreaker: the Feed pages on `(created_at, id)`, and the Milestone card takes the newest
  instant *then* the loudest event in it.
- **`isError` on an infinite query is true when any page fails.** Use `isLoadingError`, or
  one bad page replaces the whole list.
- **Two `Modal`s must not swap in one commit.** React batches, so on iOS the present is
  issued while the dismiss is in flight and UIKit drops it. Android is unaffected, which is
  exactly why it nearly shipped. Defer the second with `requestAnimationFrame`.
- **`<Avatar name="">` renders `?`, not an empty circle.** `pending` is what draws the ring.
- **PostgREST truncates at `max_rows = 1000` and says nothing.** Any `select` that can
  return more than a thousand rows has to page. `goals.target` has no upper bound. The
  Board's Increment counts used to be the worst case and no longer are — `board_tile_counts()`
  (migration 42) aggregates them in SQL, so twenty-five rows come back however busy the
  Board is. That is the shape to reach for: a count that cannot exceed a page cannot be
  silently truncated, and it took a round trip out of opening a Board on the way past.
- **Percentage widths cannot lay out a 5-across grid.** React Native has no `calc()`. Use
  rows of `flex: 1`. `CentreGlyph` shipped for weeks rendering 4 across in seven rows.
- **A container `accessibilityLabel` without `accessible` never announces**, and adding
  `accessible` collapses the subtree on iOS. Collapse only where the label reproduces every
  child; never over a grid of 25 Tiles.
- **`router.back()` assumes a history that often is not there.** Use `leaveTo()`.
- **zsh globs `[id].tsx`** — write route files with the file tool, not a heredoc.
- **iOS reports a portrait photo's dimensions sideways.** `ImageRef.width/height` are
  `cgImage` pixels while the resizer works from the orientation-corrected `UIImage.size`,
  so bounding the "long edge" bounded the short one and every portrait iPhone photo came
  out a third over §16.4's limit — upright, and wrong. Measure the *output* and bound again.
- **An object in a bucket with no row pointing at it can never be cleaned.**
  `orphaned_objects` is written only by an AFTER DELETE trigger on `attachments`, so an
  upload interrupted before its row is written is invisible and permanent. Write the row
  first: a path with no bytes renders as §3's hatch and is clearable, which is a failure you
  can see.
- **A queue may only forget a tap the server actually refused.** `404` is about the route,
  not the row — PostgREST answers it during a schema-cache reload after a deploy — so
  "drop on any 4xx" quietly destroyed a week of offline taps. Enumerate `drop`; let `keep`
  be the fallthrough. A tap kept forever is bounded; a tap dropped is bounded by nothing.
- **A persisted query cache is not protected by its key.** Keys carrying the Account id are
  a sufficient control for a heap that dies with the process and not for a file. Signing out
  has to `clear()`, `removeClient()` **and** empty the offline queue.
- **A helper defined twice in one test file is a trap that hides for weeks.** Ten pgTAP
  files define `tile_of()` twice; `supabase/tests/notifications.test.sql` still defines
  `tile_at`/`finish_at` twice and is the next instance waiting to bite.

---

## Open items

**Spec contradictions worth settling.** Each was resolved in code toward the source named,
and the documents should be corrected so the next reader does not undo it.

1. **§4.4 vs §18.6 on what a Swap does to progress.** §4.4 says the Tile resets because
   `COUNT(increments)` on the new Goal is zero. There is no new Goal — `swap_tile()` updates
   in place — `increments` references `tile_id`, and §18.6 says progress **carries over**.
   Resolved toward §18.6 and the migration. §4.4's sentence is a stale model of the schema.
2. **§1.5 vs §4.6 on deleting an Account.** §1.5 takes Managed Members with it; §4.6 says
   they transfer. `delete_account()` implements §1.5 and the Account screen says so. No
   transfer flow is specified and ADR-0003 puts conversion out of scope. A product decision
   worth making before a public listing.
3. **§4.2 vs §7 on Sharpening**: "One call per Goal, no reroll" and a "Sharpen it again"
   row. And PRD §7's acceptance test says "2–3 alternatives" while §4.2 says one, never a
   menu. Both resolved toward the prose rule.
4. **§3's `<FeedRow>` table has no row for a vote outcome**, though §14.2 requires them in
   the Feed. The clay-dot-on-`clayTint` glyph is an invention — a good one, matching the
   shared Centre Tile's own mark, but an invention.
5. **§3 asks for "remaining budget in `meta`" on a Feed Swap row.** The `feed` view carries
   no swaps-used column, so it is not rendered.
6. **§3's Wrapped rail is "6-segment"**, but a Member with no Board that Year has no
   `wrapped_member_cards` row and gets four cards. The rail renders `deck.length`.

**Known gaps.**

7. **Two of §4.8's five switches are deliberately not built** — "the Centre moves" and
   "swaps" — because no notification kind exists behind either. `resolve_center_vote()` and
   `swap_tile()` write a Feed row and nothing else. A preference that silently controls
   nothing is worse than an absent one. Each needs a kind, a `notify_family()` call, copy in
   `notify`, and a column on `notification_preferences`.
8. **`writeGoalFailureCopy`'s centre branch is dead.** `write_goal()` raises `PT403` for
   both "this Board is sealed" and "the Center Tile is the Family's", and the sealed branch
   claims every `PT403` first — so a Member who reaches the Centre in a shared-mode Year is
   told their board has sealed. Fixing it means a distinguishable SQLSTATE in the migration.
9. **`ithertzalot` has no Board in the 2026 Year**, only 2027 — approved after 2026 opened.
   Slice 21's machinery handles this shape now, but that Account is still a 2026 voter with
   nowhere to write goals.
10. **The Line pip strip is not on the Family screen.** §3 suggests one per Member; it needs
    a Tile-count read for every Board in the Family rather than the caller's own.
11. **"Wrapped" is flagged in FRONTEND_DESIGN §8** as strongly associated with another
    company's product, suggesting *The Almanac*. The codebase says Wrapped; some copy says
    Almanac. Cheap to settle now rather than after it is in forty files.
12. **CI/CD** — discussed, not built. First move is a GitHub Action running `tsc` + Vitest
    on every PR; pgTAP needs a Supabase service container.
13. **Apple and Google sign-in are not configured** on the Supabase project. Magic link
    works, but the default SMTP sends two emails an hour. `dev-login` is the way round it
    and the README explains it. It is a back door gated on `DEV_LOGIN_SECRET`; unset the
    secret to close it, and never set it on a project holding real data.
14. **Web sessions use `localStorage`** and the module throws on any non-localhost origin.
    Revisit if web ever becomes a real target.
15. **Dark mode (§1.2) is specified and not wired up.** The tokens exist; nothing resolves
    them, and `app/_layout.tsx` hardcodes a dark status bar because "every ground is
    `paper`" — which stopped being true when Wrapped's `mossDeep` cards landed.

---

## Deploying

See [`../README.md`](../README.md) → "Deploying to a Supabase project". The two Vault
secrets and the Edge Function secret are already set on the live project; a new project
needs them again, and `notification_preferences` is backfilled by its own migration.

---

## The web deployment, and what is still open

Written at the end of the session that put the app on the internet. Everything above this
line is about building the product; this is about running it.

### Where it is

**https://family-bingo.pages.dev** — Cloudflare Pages, deployed from GitHub Actions after
the suites pass. Supabase project `sugmraaaybgczbxiribw` (free tier, us-west-2).

- `/` is a landing page a stranger can read. `/signin` is the sign-in screen. `/demo` opens
  a read-only Family.
- **Google is the only sign-in route on web.** Apple needs the paid programme for a Service
  ID; the magic link needs an SMTP provider, which needs a domain. Both are still coded and
  dormant — the sign-in screen hides what it cannot complete rather than offering a control
  that answers "isn't set up yet".
- **Sign-up is invite-only** (`signup_allowlist`, migration 37), enforced in the trigger on
  `auth.users`. It gates **every** identity GoTrue creates, including admin-API creates —
  the two are byte-identical at the database, probed both ways.
- `familybingo.app` is earmarked and unbought. Buying it turns the magic link back on and
  gives the site a URL worth putting on a CV.

### Two bugs left open, both in the demo

1. **The demo offers controls it refuses.** "Create a Family" and "Join a Family" render on
   `/home` for the demo Account, and migration 39 answers both with
   `42501 the demo Account cannot change anything`. §0.3: never offer a retry that cannot
   work. Fix is to hide them when `isDemoAccount(session.user.email)` — `src/domain/demo.ts`
   already exports the predicate.
2. **The demo session persists and collides with a real one.** It is an ordinary Supabase
   session in `sessionStorage`, so opening the demo and then signing in properly can leave
   the demo Board on screen. "Leave" should be a real sign-out, and entering the demo should
   probably refuse (or warn) when somebody is already signed in as themselves.

### Things that cost time here, in the order they will cost it again

- **Cloudflare Pages silently drops anything under a `node_modules` path.** A font imported
  from `@expo-google-fonts` lands at `/assets/node_modules/…`, the deploy goes green, every
  request 404s into the SPA fallback, and the app renders in system faces. Nothing reports
  it. Fonts are vendored under `assets/fonts/` for this reason and `deploy.yml` fails the
  build if one reappears under that path.
- **`Alert.alert` is a no-op on react-native-web** — literally `static alert() {}`. Four
  destructive confirms did nothing on the deployed build. Use `<ConfirmSheet>`; do not
  reintroduce `Alert`.
- **The database URL is the recurring trap.** Three separate hours went to it: a
  `[YOUR_PASSWORD]` placeholder left in a secret; `DEMO_DB_URL` set without `export`, so the
  demo seeded a laptop while production stayed empty; and the **session pooler needs the
  username `postgres.<project-ref>`**, not plain `postgres` — the pooler reports the wrong
  username as a password failure. `scripts/seed-demo-family.mjs` now prints its target
  before writing.
- **`workflow_run` did not fire the deploy** after CI passed, during and after a GitHub
  Actions outage. `gh workflow run Deploy --ref main` is the manual path. If it keeps not
  firing, make the deploy a job in `ci.yml` gated on `gate` and `main` instead.
- **Web-only bugs are invisible to every suite.** The callback spinner, the dead confirms
  and the missing fonts all passed 758 unit tests, 953 pgTAP assertions and 24 integration
  tests. A small Playwright smoke test — load the deployed build, assert a font loaded,
  click a confirm, assert the sheet appears — would have caught all three. **Not built.**

### Running the demo seed

Needs three exported variables. The banner it prints first says which database it chose;
if it says LOCAL when you meant production, stop.

```sh
export DEMO_DB_URL='postgresql://postgres.<ref>:<password>@aws-1-us-west-2.pooler.supabase.com:5432/postgres'
export SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='eyJ...'   # the service_role JWT, never a sb_secret_ key
node scripts/seed-demo-family.mjs
```

`awards: 0` with `wrap: HTTP 503` means the Edge Function cold-started; re-run `wrap` rather
than re-seeding. Seeding locally leaves a demo Family in the stack, which breaks the pgTAP
suites that do `select id from families limit 1` — `npx supabase db reset` before running
them.

### Verified from outside, and worth re-checking after any change to migration 39

With a real demo session: only the demo Family is visible, only its four Members, an
Increment insert is refused `42501` at RLS (the Year is frozen), and `create_family` and
`create_managed_member` are both refused by the demo guard.

### Still to do

- The two demo bugs above.
- **Make the repo public and protect `main`** — require only the `gate` check, block
  force-push and deletion, allow self-merge. Deliberately left until CI was demonstrably
  working. `DEV_LOGIN_SECRET` is already unset on the live project.
- A screen recording at `public/demo.mp4` with a poster at `public/demo-poster.png`. The
  landing page HEADs the file and checks its content type, so it renders nothing until one
  exists — `_redirects` answers a missing file with `index.html` at 200, which a naive
  `<video>` would show as a broken frame forever.
- The Playwright smoke test.
- `docs/api.md` still documents functions and signatures that have moved; it has been
  corrected twice and is worth a full pass.
