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
| 10 Seal | **In progress** on `slice-10-seal` — see below |
| 11–21 | **Not started** |

Suites: **411 Vitest · 794 pgTAP · 19 integration**, `tsc` clean. All three must pass
before a merge.

### Where slice 10 got to

The server half (`seal_year`, `seal_due_boards`, the `pg_cron` job) shipped with the
server. The client half is **the Board being drawn**, because §4.1 says authoring is a
list and "the board isn't drawn until it seals" — so sealing is the moment twenty-four
sentences become a grid.

Done and typechecking on the branch:

- `components/Sunflower.tsx` — 8 `View` petals + disc, memoised, all geometry from the
  already-tested `src/ui/sunflower.ts`
- `components/Tile.tsx` — the five growth stages of §2, including the leaf positioned
  against the *stem* rather than the tile
- `components/Board.tsx` — 5×5, never scrolls, plus the 12-segment line pip row
- `app/board/[id].tsx` branches: sealed renders the grid, a draft renders the list
- `useTileCounts` — `COUNT(increments)` per Tile, never denormalised (§11.4)

Not done: nobody has **looked at it**. No sealed Board exists in the dev data, so the
growth ladder has never been rendered — that is the first thing to check, and it needs a
Board with `sealed_at` set and some Increments. Tapping a Tile is deliberately inert;
the TileSheet and one-tap logging are slice 11.

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
- **No simulator on this machine** (Intel Mac, macOS 15.7, no Xcode). `npx expo start --web`
  is one preview; **Expo Go on the user's iPhone 15 (iOS 26.6)** is the other. The
  assistant **cannot see either** — the Chrome automation drives a different machine's
  browser. The user is the eyes; ask them to look when a screen's type or spacing matters.
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
