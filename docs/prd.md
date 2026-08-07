# Family Bingo — Product Requirements

> **Audience: an implementing agent.** This document is written to be executed, not
> interpreted. Every requirement is numbered, testable, and paired with the decision
> that produced it. Where a requirement could be read two ways, the ambiguity is
> resolved explicitly rather than left to judgment.
>
> **Read [`../CONTEXT.md`](../CONTEXT.md) first.** It is the glossary. Every capitalized
> domain term in this document (Member, Board, Tile, Sharpening, Swap…) is defined
> there, and the code should use those names.
>
> **Rule for the implementer:** if a requirement here is genuinely ambiguous, stop and
> ask. Do not invent an answer and proceed — a wrong guess encoded in the schema is
> expensive to unwind.

---

## 1. What this is

An annual goal-setting game for families. Each person fills a 5×5 board with personal
goals for the year and works to complete them, while their family watches, cheers, and
gets notified as squares fall.

**The core loop:** author 24 goals in December → seal when the Family is finished, or on
the deadline → play from 1 January → log progress all year → complete Tiles → hit Bingo →
Blackout.

Sealing and the start of the Year are two different moments (§22.5). They coincide for a
Family who never declare themselves done, which is why this sentence read "seal on January
1" until slice 22.

**What makes it not a habit tracker:** the Family is a real participant. It votes on the
Center Tile, sees every Increment in a shared Feed, gets notified on Milestones, and
sees every Swap. The social layer is the product.

### 1.1 Non-goals

Explicitly out of scope. Do not build these, and do not design for them.

| Not building | Why |
|---|---|
| Ranking, leaderboards, or a "winner" | Boards are self-authored — ranking measures who set the easiest goals, not achievement (§13.5). Wrapped Awards are the one bounded exception, and are deliberately *not* a ladder ([ADR-0006](adr/0006-wrapped-awards.md)) |
| Streaks or per-period enforcement | A missed month must never make a Tile permanently unachievable (§4.3) |
| Public/global feeds, discovery, following | Nothing crosses a Family boundary, ever (§5.1) |
| Direct messaging | The Feed and Increment notes are the only communication surface |
| Web client | Mobile only (Expo iOS + Android) |
| Monetization | Not in v1. Do not add billing tables or entitlement checks |

---

## 2. Users

| Who | How they access | Notes |
|---|---|---|
| **Adult Member** | Own Account (Apple / Google / magic link) | Authors a Board, logs Increments, votes |
| **Organizer** | Own Account | An adult Member with extra powers: invites, approves joins, opens the Year, breaks tied votes. Plays like anyone else |
| **Managed Member** (child) | **No login.** Played through a Guardian's Account | Has a name, avatar, Board, and Goals — never an email, password, or session |

**Design constraint that follows:** `Account → Member` is **one-to-many**. One Account may
drive several Members in the same Family (self + two children). The UI needs a profile
switcher; the schema needs `members.guardian_account_id`.

---

## 3. Vertical slices

The build is organized as **thin vertical slices**. Each slice cuts through the entire
stack — migration → RLS policy → Edge Function (if needed) → client screen — and ends
at a **user-observable capability**. No slice is "build the data layer" or "build the
API"; every slice is something a person can do.

### 3.1 The rule

> **Write the acceptance test first. Watch it fail. Make it pass. Refactor.**
>
> A slice is not done when the code exists. It is done when its acceptance test passes,
> the previous slices' tests still pass, and the capability is demonstrable on a device.

Each slice below states its **acceptance test** in Given/When/Then form. That test is
the first thing written and the definition of done.

### 3.2 Test layers

| Layer | Tool | What it covers | When |
|---|---|---|---|
| **Domain unit** | Vitest | Pure logic — line detection, progress math, vote resolution, swap budget | Every slice with logic |
| **Database** | pgTAP (`supabase test db`) | **RLS policies.** Every table, every role, both directions: authorized reads succeed, cross-Family reads return zero rows | Every slice touching a table |
| **Integration** | Vitest + local Supabase | Edge Functions end-to-end against a real database | Slices 7, 15, 19, 20 |
| **E2E** | Maestro | The acceptance test as written, driven on a simulator | Every slice |

**The database layer is not optional.** Requirement §5.1 (nothing crosses a Family
boundary) protects photographs of children. An RLS policy without a negative test —
one that asserts another Family's Account gets **zero rows**, not an error — is an
untested security control.

---

## 4. Phase 1 — Setup

*Goal: a family can be assembled and boards authored. Everything needed before a Year
can seal.*

### Slice 1 — Sign in

**Acceptance test**
> **Given** a person with no Account
> **When** they open the app and complete Sign in with Apple
> **Then** an Account exists and they land on an empty home screen offering "Create a
> Family" or "Join a Family"

**Requirements**

- **1.1** Three auth methods, all passwordless: Sign in with Apple, Google, email magic link.
- **1.2** **Never treat email as an identity key.** Apple private-relay addresses change and are not unique per person. Join only on `accounts.id`.
- **1.3** No password is ever stored, prompted for, or reset. There is no password UI.
- **1.4** Session tokens in `expo-secure-store`, never `AsyncStorage`.
- **1.5** Account deletion must exist from day one (App Store requirement, and Q1 chose "public eventually"). Deleting an Account deletes every Member it owns and every Managed Member it guards, cascading to their Boards, Goals, Increments, and Attachments.

### Slice 2 — Create a Family

**Acceptance test**
> **Given** a signed-in Account with no Family
> **When** they create a Family named "Hertzell Family"
> **Then** the Family exists, they are a Member of it with role `organizer`, and the
> Family appears on their home screen

**Requirements**

- **2.1** Creating a Family creates the creator's Member row with `role = 'organizer'` in the same transaction.
- **2.2** An Account may create or belong to **multiple** Families. Every subsequent screen is scoped to exactly one Family at a time; there is a Family switcher.
- **2.3** Family name: 1–60 characters, no uniqueness constraint (two unrelated "Smith Family" groups are fine).

### Slice 3 — Invite and approve

**Acceptance test**
> **Given** an Organizer and a second Account
> **When** the Organizer generates an Invitation, the second Account opens the link,
> and the Organizer taps Approve
> **Then** the second Account is a Member with role `member`, and can see the Family's
> Boards
>
> **And given** the same link is opened a second time by a third Account
> **Then** it is rejected as already used

**Requirements**

- **3.1** An Invitation is **single-use** and expires **7 days** after creation.
- **3.2** Following a valid Invitation creates a Member with `status = 'pending'`. **Pending Members can see nothing** — not the Feed, not Boards, not other Members' names. This is a hard RLS boundary, not a UI state.
- **3.3** The Organizer receives a push notification and approves or rejects. Approval sets `status = 'active'`.
- **3.4** The Organizer can revoke an unused Invitation and can remove a Member at any time.
- **3.5** Rationale — do not simplify this away: invite links get forwarded into group chats. Single-use handles the accidental forward *after* first use; approval handles the forward *before* first use. Both are required because the payload behind this boundary is photographs of children.

### Slice 4 — Managed Child Profiles

**Acceptance test**
> **Given** an adult Member
> **When** they create a child profile named "Theo"
> **Then** a Member exists with `guardian_account_id` set to the adult's Account and no
> `account_id`, Theo appears in the Family, and the adult can switch to acting as Theo

**Requirements**

- **4.1** A Managed Member has `account_id IS NULL` and `guardian_account_id NOT NULL`. Exactly one of the two is set — enforce with a `CHECK` constraint.
- **4.2** A Guardian acts on behalf of a Managed Member: authoring Goals, logging Increments, voting. All such actions are attributed to the **Managed Member** in the Feed, not the Guardian.
- **4.3** The Guardian is accountable for all content posted under a Managed Member, including Attachments. Surface this in the profile-creation flow.
- **4.4** A Managed Member has no email, no password, no session, and cannot be invited or promoted. Converting one to a real Account is **out of scope** — do not build it.
- **4.5** Removing a Managed Member deletes its Board, Goals, Increments, and Attachments.

> **Compliance note.** This design exists so that parental consent is *inherent* — the
> Guardian created the profile — rather than bolted on. Before any public listing, this
> area needs review by an actual lawyer. Do not add features that collect additional
> data from Managed Members.

### Slice 5 — Open a Year

**Acceptance test**
> **Given** an Organizer in a Family with 3 active Members
> **When** they open Year 2027
> **Then** a Year exists with `status = 'setup'` and a deadline of 2027-01-01, and each
> active Member has a draft Board with 25 empty Tiles

**Requirements**

- **5.1** Only the Organizer opens a Year. One Year per Family per calendar year.
- **5.2** Opening a Year starts the **Setup Window**, whose **deadline** is `YYYY-01-01T00:00:00` in the Family's timezone. Minimum: **7 days** — if opened later than 7 days before Jan 1, the deadline is `now + 7 days`. The seven days are a floor under the *deadline*, not a minimum length for the window: a Family may finish sooner and seal sooner (§22.1), and nobody's authoring time is shortened by that, because it takes every one of them saying so.
- **5.2a** That same `YYYY-01-01T00:00:00` is when **play opens**, and it is a separate fact from the deadline — the two coincide only when the Year was opened more than seven days out. Since §22 they can also come apart in the other direction, because a Family may seal early. Stored as `years.play_opens_at`.
- **5.3** Board creation is idempotent — 25 Tiles at positions 0–24, position 12 is the Center Tile.
- **5.4** Positions are **row-major, 0-indexed**: position `p` is row `p / 5`, column `p % 5`. This is load-bearing for line detection (§6.3); do not change it.

### Slice 6 — Write a Goal

**Acceptance test**
> **Given** a Member with a draft Board
> **When** they type "Read more books" into Tile 3 and set a target of 12 books
> **Then** Tile 3 holds that Goal with `target = 12` and `unit = 'books'`, and it
> persists across an app restart

**Requirements**

- **6.1** A Goal has: `text` (1–200 chars), `target` (integer ≥ 1), `unit` (nullable, ≤ 30 chars — the Member's own wording), `unit_canonical` (nullable, singular lowercase), `category` (nullable enum), `pace_hint` (nullable display string, e.g. `"about 1 a month"`).
- **6.1a** `unit_canonical` and `category` exist so Wrapped can aggregate across Members (§Slice 20). They are **inferred during Sharpening** (§7.10), never typed by the Member and never shown as a form field. A Goal that skipped Sharpening leaves both `NULL` — that Goal still counts everywhere except aggregate Wrapped cards.
- **6.2** `target = 1` **is** the one-shot shape. There is no separate type column and no enum. This is deliberate — see [ADR-0002](adr/0002-cumulative-goals-only.md).
- **6.3** `pace_hint` is **display only**. It is never used in any completion, progress, or eligibility calculation. Nothing in the codebase may branch on it.
- **6.4** Tiles may be filled in any order and edited freely while the Board is a draft.
- **6.5** The Center Tile (position 12) is **not** editable in this slice — it is resolved by the Center Vote (Slices 8–9).

### Slice 7 — Sharpening

**Acceptance test**
> **Given** a Member authoring a Goal
> **When** they type "take a walk every day" and tap Sharpen
> **Then** 2–3 alternatives are returned, each with `text`, `target`, `unit`, and
> `pace_hint` pre-filled (e.g. "Walk 300 times", target 300, unit "walks", pace "about
> 6 a week")
> **And** they can accept one, edit it, or **keep their original wording** — and
> keeping the original produces a valid Goal with `target = 1`

**Requirements**

- **7.1** Sharpening runs in a Supabase Edge Function. **The API key never reaches the client.**
- **7.2** Model: `claude-opus-5`. Set `output_config: { effort: "low" }` — this is an interactive field with a user waiting, and Opus 5 thinks by default.
- **7.3** Use **structured outputs** (`output_config.format` with a JSON schema) so the response validates to `{ suggestions: [{ text, target, unit, unit_canonical, category, pace_hint }] }`. Do not parse prose.
- **7.10 — Two fields exist purely for Wrapped.** `unit_canonical` (singular, lowercase — `"book"` for a Member who typed `Books`) and `category` (one of `fitness | family | learning | money | health | creative | other`). Both are inferred by the model in the **same call** — no extra request, no added latency, no user-facing field. This is what makes "together you read 47 books" computable at year end; without it, free-text units never group and the card is impossible to build retroactively.
- **7.4** Apply `cache_control: { type: "ephemeral" }` to the system prompt. Opus 5's cacheable minimum is **512 tokens** — write the system prompt to clear it.
- **7.5 — The most important requirement in this document.** Sharpening **never blocks**. There is no validity check, no rejection, no "your goal isn't specific enough." If the Member keeps their original text, it becomes a one-shot Tile and the app says nothing further.
- **7.6** The system prompt must handle emotionally-loaded goals with care. The canonical hard case is **"Be a better father."** Good output offers something like *"One-on-one outing with each kid, 12 times"* — concrete, warm, not clinical. Bad output is preachy, generic, or implies the original goal was inadequate.
- **7.7** When the Setup Window opens mid-year (late joiner, §8.1), pass the remaining fraction of the year so proposed targets scale (≈70 walks, not 300).
- **7.8** Rate limit: 100 Sharpening calls per Member per Year. Generous enough to never be hit in normal use; bounded against a runaway loop.
- **7.9** On any failure — timeout, refusal, malformed response — **fail open**: show "Couldn't get suggestions, your goal is saved as written" and keep the Member's text. Never lose input, never block on the model.

> **`stop_reason` handling.** Check `response.stop_reason` before reading `content`.
> Opus 5 can return `stop_reason: "refusal"` with an empty `content` array; indexing
> `content[0]` unconditionally will throw. Treat a refusal as a §7.9 failure.

### Slice 8 — Center Vote, mode

**Acceptance test**
> **Given** a Family of 4 in an open Setup Window
> **When** 2 Members vote "shared" and 1 votes "personal" and 1 never votes
> **Then** the mode resolves to **shared**, and the non-voter is recorded as an
> abstention rather than blocking the outcome

**Requirements**

- **8.1** Each active Member casts at most one mode Ballot: `shared` or `personal`. Ballots are changeable until the deadline.
- **8.2** Resolution is a **majority of Ballots cast**. Non-voters are abstentions.
- **8.3** A tie, or zero Ballots cast, resolves to **`personal`** — the fallback requiring no further coordination.
- **8.4 — Never blockable by inaction.** No quorum, no unanimity, no waiting on a non-voter. In any family of 5+, at least one person is a lurker; their silence must not freeze four other people's Boards. §22.1 adds unanimity as a way to finish *early* and does not weaken this: silence there costs the Family a shortcut, never an outcome — the deadline still arrives on schedule and seals exactly as it did before.

### Slice 9 — Center Vote, goal

**Acceptance test**
> **Given** a Family whose mode resolved to `shared`
> **When** Members submit 3 Proposals and vote, and "Camping trip" wins with 2 votes
> **Then** every Member's Tile 12 holds "Camping trip" as the Family Goal

**Requirements**

- **9.1** Runs only if §8 resolved to `shared`. Any active Member may submit Proposals (max 3 each).
- **9.2** Plurality of Ballots cast wins. A tie is broken by the **Organizer**.
- **9.3** **Zero Proposals submitted → falls back to `personal`.** Do not leave the Center Tile empty or the Board unsealed.
- **9.4** Resolution to `shared` writes the same `family_goal_id` to every Board's Tile 12.
- **9.5** If mode resolved to `personal`, each Member authors Tile 12 themselves like any other Tile.

### Slice 10 — Seal

**Acceptance test**
> **Given** a Setup Window past its deadline
> **When** the seal job runs
> **Then** every Board in that Family has `sealed_at` set, the Year is `status = 'active'`,
> and editing any Tile returns an error

**Requirements**

- **10.1** A `pg_cron` job seals Boards at the Setup Window deadline. Since §22 that deadline is a backstop rather than the only door — a Family who have all marked their Boards done seal when the last of them does — but it remains the only *clock*, and no role may seal early on its own authority.
- **10.2** Sealing happens **whether or not** authoring is complete. An unfinished Board seals with empty Tiles; those Tiles can be filled using Swaps (§7.4 of Phase 3).
- **10.3** After sealing, Goal text and Target are immutable except through a Swap.
- **10.4** Sealing is idempotent and safe to re-run.

---

## 5. Phase 2 — Play

*Goal: the game is playable end to end. This is the MVP for family testing.*

### Slice 11 — Log an Increment

**Acceptance test**
> **Given** a sealed Board with a Goal of target 144
> **When** the Member taps the Tile once
> **Then** an Increment exists, progress reads 1/144, and the Tile shows a progress
> indicator

**Requirements**

- **11.1** Logging is **one tap**. A note is optional and never required.
- **11.2** Every Increment carries a **client-generated UUID** as its primary key. The insert is idempotent on that UUID — this is what makes the offline queue (§Slice 17) safe.
- **11.3** Increments are **append-only**. No edits. A mistake is corrected by deleting the Increment, which is the only mutation permitted.
- **11.4** Progress is `COUNT(increments)` for the Goal. **Do not denormalize a counter** — a cached count and an append-only log will drift, and the log is the source of truth.
- **11.5** Increments cannot be logged before the Board's `sealed_at`, before the Year's `play_opens_at` (§22.5), or after its `frozen_at`. No backdating: `occurred_at` is floored at the later of the seal and the start of play.

### Slice 12 — Complete a Tile

**Acceptance test**
> **Given** a Goal with target 3 and 2 Increments
> **When** a third Increment is logged
> **Then** the Tile is complete, a Milestone is recorded, and the Tile renders as filled

**Requirements**

- **12.1** A Tile is complete when `COUNT(increments) >= target`. Derived, not stored as a flag.
- **12.2** Crossing the threshold emits exactly **one** `tile_completed` Milestone. Logging further Increments past the target does not emit another.
- **12.3** The Family Goal (shared Center Tile) completes **for every Member simultaneously** when marked done. Any Member may mark it; the Feed records who did.

### Slice 13 — Lines, Bingo, Blackout

**Acceptance test**
> **Given** a Board with Tiles 0, 1, 2, 3 complete
> **When** Tile 4 completes
> **Then** a Line is recorded for row 0, a `bingo` Milestone fires (it is the Member's
> first Line), and the Board shows 1 of 12 Lines

**Requirements**

- **13.1** **12 Lines:** 5 rows, 5 columns, 2 diagonals. Enumerate them as constants against the row-major indexing of §5.4 — do not compute them dynamically.
- **13.2** The **first** completed Line emits a `bingo` Milestone. Every subsequent Line emits a quieter `line_completed` Milestone.
- **13.3** All 25 Tiles complete emits a `blackout` Milestone.
- **13.4** **Play continues after Bingo** to the end of the Year. Bingo is a rung on a ladder, not an ending.
- **13.5 — Do not build ranking.** No leaderboard, no ordering of Members by progress, no "first to bingo." Boards are self-authored; ranking them measures goal difficulty, not achievement. See [ADR-0001](adr/0001-personal-boards.md).
- **13.5a — The one exception, and its exact shape.** Wrapped (§Slice 20) hands out **Awards** at year end. This is permitted because a *live* ladder shapes behavior all year while a *retrospective* superlative only describes what happened. The permission is narrow: Awards must sit on **unrelated axes** and there must be **at least as many Awards as Members**, so nobody places above anyone. A single ordered "most tiles completed, 1 through N" list is still forbidden. See [ADR-0006](adr/0006-wrapped-awards.md).
- **13.6** Line detection is **pure domain logic** — a function from a set of completed positions to a set of Line indices. Unit-test it exhaustively before it touches the database.

### Slice 14 — The Feed

**Acceptance test**
> **Given** a Family with recent activity
> **When** a Member opens the Feed
> **Then** they see a reverse-chronological list of Increments (with notes), Milestones,
> Swaps, and vote outcomes — **for their Family only**
>
> **And given** an Account in a different Family queries the same endpoint
> **Then** zero rows are returned

**Requirements**

- **14.1** The Feed is scoped to one Family and one Year. Paginated, newest first.
- **14.2** Contains: Increments (with notes and Attachments), Milestones, Swaps, vote outcomes, Members joining.
- **14.3** The second half of the acceptance test is a **pgTAP test, not a UI check**. It must assert zero rows, not an error.

---

## 6. Phase 3 — Retention

*Goal: the app reaches out and stays usable in the real world. This is where retention
lives — not optional, just not needed on day one.*

### Slice 15 — Push notifications

**Acceptance test**
> **Given** a Member with push permission granted
> **When** another Member in their Family completes a Tile
> **Then** they receive a push notification within 30 seconds
>
> **And when** that Member logs a bare Increment
> **Then** no push is sent

**Requirements**

- **15.1** **Push:** `tile_completed`, `bingo`, `blackout`, invite received, join approved, Setup Window closing (24h warning).
- **15.2** **Feed only, never push:** individual Increments.
- **15.3** Rationale — do not "improve" this by pushing Increments. A family of six generates ~9 Increments/day (~3,300/year). Pushing them means ~80 notifications in the first nine days, after which the user disables notifications **at the OS level**, where the app can never win them back. Tile completions land at ~1 per 2.5 days: a heartbeat. Notification permission is a one-way door; spend it only on things worth hearing about.
- **15.4** `expo-notifications` over APNs + FCM. Device tokens in `device_tokens`, refreshed on launch, pruned on delivery failure.
- **15.5** Fan-out in an Edge Function triggered by Milestone insert. Never notify the Member who caused the Milestone.

### Slice 16 — Photos

**Acceptance test**
> **Given** a Member logging an Increment
> **When** they attach a photo
> **Then** it uploads to Supabase Storage, appears in the Family Feed, and is
> **unreadable** by any Account outside the Family — including by direct URL

**Requirements**

- **16.1** One optional Attachment per Increment.
- **16.2** Stored in a **private** Storage bucket. Access via **signed URLs with a short TTL**. No public bucket, no guessable path, ever.
- **16.3** Storage RLS mirrors the Family boundary exactly.
- **16.4** Client-side downscale to max 2048px long edge before upload.
- **16.5 — Test the negative case.** An unauthenticated request and a wrong-Family authenticated request must both fail against a real object URL. This is the single highest-consequence test in the suite: the payload is photographs of children.
- **16.6** Deleting an Increment deletes its Attachment from Storage, not just the row.

> **This is the feature that carries the most risk.** It is also the one that makes the
> Feed worth reading. Both are true. See [ADR-0005](adr/0005-photo-attachments.md).

### Slice 17 — Offline logging

**Acceptance test**
> **Given** a Member with no network connection
> **When** they log 3 Increments and connectivity returns
> **Then** exactly 3 Increments exist server-side — and re-running the sync creates no
> duplicates

**Requirements**

- **17.1** Offline queue covers **Increments only**. Authoring, voting, and invites remain online-only. Deliberately narrow.
- **17.2** Optimistic UI: progress updates immediately on tap.
- **17.3** The queue persists across app restarts.
- **17.4** Idempotency comes from the client-generated UUID (§11.2) — an upsert on primary key. **No conflict resolution logic is needed**, because Increments are append-only and two devices adding rows can never disagree. This property is why the offline scope is narrow; do not extend it to Boards without solving merge semantics first.
- **17.5** Board and Feed cached read-only so the app opens to content rather than a spinner.

### Slice 18 — Swaps

**Acceptance test**
> **Given** a Member with a sealed Board and 3 Swaps remaining
> **When** they replace a Goal
> **Then** a Revision records the before and after, the Feed shows the Swap to the
> Family, and 2 Swaps remain
>
> **And when** a Member with 0 Swaps remaining attempts one
> **Then** it is rejected

**Requirements**

- **18.1** **3 Swaps per Member per Year.** Enforced in the database, not just the UI.
- **18.2** A Swap is: replacing Goal text, **or lowering a Target**. Both count.
- **18.3** **Raising a Target is free** and is not a Swap — making a Goal harder needs no policing.
- **18.4** Every Swap writes an append-only **Revision** (before, after, timestamp) and appears in the Feed.
- **18.5** Rationale: a Bingo notification is a *social claim*. Without a swap budget, anyone could lower a target from 144 to 90 in November and manufacture a Bingo. Scarcity plus visibility closes that without making the Board a prison. Filling an empty Tile on an unfinished sealed Board also costs a Swap.
- **18.6** Swapping does not delete existing Increments; progress carries over against the new Target.

---

## 7. Phase 4 — Payoff

### Slice 19 — Weekly Digest

**Acceptance test**
> **Given** a Family with a week of activity and a Member opted in
> **When** the weekly job runs
> **Then** that Member receives one summary push and no others receive it

**Requirements**

- **19.1** `pg_cron` weekly. **Opt-in, default off.**
- **19.2** Content: Family activity count, notable Milestones, Members near a Line.
- **19.3** Skip entirely if the week had no activity. Never send an empty digest.

### Slice 20 — Freeze and Wrapped

> **Wrapped absorbs what was previously specced as a separate "Recap."** They were ~80%
> the same queries and the same UI. One feature.

**Acceptance test**
> **Given** an active Year with activity from 4 Members
> **When** the clock passes December 31, 23:59:59 in the Family's timezone
> **Then** the Year is frozen, further Increments are rejected, Wrapped is generated,
> every Member receives a push, and each sees swipeable cards covering their own stats,
> the Family's aggregates, the Awards, the Family Goal outcome, and a button into next
> year's board
>
> **And** every Member has received **at least one** Award

**Why this slice matters more than its position suggests.** Wrapped is not a closing
ceremony — it lands in the gap between one Year freezing and the next Setup Window
opening, while families are still together over the holidays and need a reason to write
24 more goals. For an annual app, being forgotten before year two is the default
outcome, and this screen is the main defense against it.

**Requirements**

- **20.1** `pg_cron` freezes at year end. Frozen Years are permanently read-only — no backdating.
- **20.2** Wrapped is **generated once at Freeze and materialized**, not computed per view. It is read many times, changes never, and must render instantly.
- **20.3** Every Member receives a push **simultaneously** so the Family experiences it together, rather than trickling through it alone across a week.
- **20.4** **Personal cards** — Tiles completed of 25, Lines, Blackout, total Increments, best month, longest-running Goal, notes written, photos added, Swaps taken, target vs. actual on the Goal they most exceeded.
- **20.5** **Family cards** — aggregate Increments; **unit aggregation** grouped on `unit_canonical` ("together you read 47 books and walked 2,100 times"); the category breakdown ("your year was 40% fitness"); the Family Goal outcome; a timeline of Milestones; the month the Family was most active.
- **20.6** **Awards** — see §20.7. **Final card is not a stat**: "Ready for 2028?", linking straight into opening the next Year.
- **20.7 — Award rules, and they are load-bearing:**
  - Awards sit on **unrelated axes**. Suggested set: Most Increments · Biggest Single Month · Most Consistent (smallest median gap) · Longest-Running Goal (first-to-last Increment span) · Best Comeback (worst month → best month) · Most Photos · Most Notes Written · First Bingo · Most Exceeded Target · Quietest Achiever (fewest Increments, still completed a Line).
  - **Every Member must receive at least one Award.** If the natural winners leave someone out, assign from the remaining unclaimed axes. Test this explicitly — a family of 6 where one person gets nothing is the failure mode.
  - **No single ordered list of Members.** Not "most tiles completed, ranked 1–N." An Award names one person on one axis; it never implies a standing (§13.5a).
  - Ties: award both.
- **20.8** Goals with `unit_canonical IS NULL` (skipped Sharpening, §6.1a) are excluded from **aggregate** cards only. They still count in every personal stat, Award, and Line.
- **20.9 — Export.** The full Family Wrapped is **in-app only**. The Share button exports **only the Member's own card, stats only** — no photos, no other Members named, no Managed Member data. Rationale: a screenshot is always possible and that's the user's call, but a one-tap button that publishes a child's name and face is the *app's* design decision. See [ADR-0005](adr/0005-photo-attachments.md).
- **20.10** Frozen Years and their Wrapped stay browsable forever as family history.
- **20.11** Opening the next Year carries **nothing** over — fresh Goals, fresh vote, clean slate.

> **Feedback loop to be aware of.** Wrapped runs days before goal-setting for the next
> Year, so whatever it celebrates is what the Family will optimize for in January. This
> is precisely why §20.7 forbids a single ladder: an app that crowns "most tiles
> completed" has taught everyone to write easier goals next year.

### Slice 21 — Late joiners

**Acceptance test**
> **Given** a Family with a sealed, active Year
> **When** a new Member is approved in July
> **Then** they get a Board with a 7-day personal Setup Window, inherit the already-
> decided Center Tile, and play through December 31

**Requirements**

- **21.1** A Member joining mid-Year gets a personal Setup Window of 7 days from approval, or until they mark the Board done — whichever comes first (§22.6).
- **21.2** They inherit the Family's already-resolved Center Tile. **The Center Vote is not reopened** — doing so would alter a Tile on every already-sealed Board.
- **21.3** Sharpening receives the remaining fraction of the year (§7.7) so proposed targets are proportionate.
- **21.4** Their Board shows a "joined July" marker so the Feed makes sense.
- **21.5** **No proration, no special-casing.** This works precisely because §13.5 removed ranking — there is no standing to be behind in.

### Slice 22 — Ready, and the early Seal

**Acceptance test**
> **Given** a Family in an open Setup Window whose Members have all written their 24 Goals
> **When** the last of them marks their Board done
> **Then** every Board in that Family seals immediately, the Center Vote resolves on the
> Ballots cast, and play still does not open until the Year begins

**The problem.** §10.1 seals on a date, and the date is the right backstop: it stops one
person's silence holding four other people at the starting line (§8.4). What it never
covered is the opposite case — a Family who are all finished are not waiting on a
decision, they are waiting on a calendar. In two shapes that costs them real days of
their own Year:

- A Year opened after 25 December has a deadline of `now + 7 days` (§5.2), so a Family
  who open on the 28th and finish on the 30th cannot play until 4 January.
- A Member approved in July gets a personal window of seven days (§21.1). They finish
  their Board in an hour and sit out a week of a Year everybody else is playing.

**Requirements**

- **22.1** The Setup Window deadline becomes a **backstop rather than the only door.** The second door is unanimity. Nothing else opens it: an Organizer with neither the date nor a unanimous Family is still refused (§10.1), because sealing early on their own authority would take authoring time from everyone else, silently and with no appeal.
- **22.2** **Ready is declared, never inferred.** A Board whose 24 authorable squares all hold a Goal may be marked done by the Member who owns it (or their Guardian, §4.2). A full Board makes the control *available*; the tap is what makes it true. Inferring it from the 24th Goal appearing would mean the last person to type silently seals four Boards — and §6.4 makes a draft freely editable precisely because people write all 24 and then reword them.
- **22.3** When **every** Board in a Year has been marked done — and still holds a Goal on every square — all of them seal at once, exactly as they would at the deadline: the Center Vote resolves first (api.md §7), positions are dealt (FRONTEND_DESIGN §4.1), and the Year becomes `active`. A Member approved during the Setup Window is a Member the Family is now waiting for.
- **22.3a** The declaration is the Member's and the seal is the Family's, so a seal that fails does **not** undo the declaration: `ready_at` stands, a warning is logged, and the sweep retries within five minutes. A Family can therefore be briefly unanimous and unsealed. Nothing else may be true in that window — no Board is playable and no Goal is immutable until the seal actually lands.
- **22.4** Ready is **revocable** until the Boards seal — which is normally the moment it is the last one, and is later than that in §22.3a's retry window. After the seal it is not, which is the same door every other edit meets (§10.3).
- **22.4a** **Emptying a square withdraws the declaration.** §6.4 keeps a draft freely editable after the tap, so a Member who goes back to reword a square has stopped being done whether or not they thought of it that way. Without this the declaration outlives the Board it described and the next Member's tap seals this one with a permanent empty square (§18.5 prices getting it back at a Swap). Rewriting a Goal in place does not withdraw it — the Board is still what its owner declared.
- **22.5 — Sealing closes authoring; it does not start the Year.** Play opens at `YYYY-01-01T00:00:00` in the Family's timezone whatever date the Boards sealed on. Increments, the Family Goal's completion (§12.3) and the free write of a personal Centre (§9.5) all resolve against **the later of `sealed_at` and `play_opens_at`** — not against either alone. Both orderings occur: a Family who seal early have the Year as the later instant, and §21.1's late joiner, whose Board seals in July, has their own seal. A Year opened *during* its own calendar year has `play_opens_at` in the past, so play opens the moment the Boards seal.
- **22.6** A late joiner (§21.1) marking their Board done seals **their Board alone**, immediately. Nobody else's window is touched, the Centre was decided months ago (§21.2), and their Year is already under way — so there is nothing to wait for and a week of it to lose by waiting.
- **22.7** Ready does **not** wait for a complete Center Vote. Ballots are changeable until the Setup Window closes (§8.1) and abstention is legitimate (§8.2) — requiring everyone to have voted would hand the quietest person in the Family exactly the veto §8.4 removes. What Ready does is bring the closing forward: **a Member's Ballot becomes final when the last Board is declared, which may be somebody else's tap and may be at any moment.** The confirm sheet must say so before the tap — to every Member, not only to whoever turns out to be last, because it is everyone else whose say can end without warning.

---

## 8. Cross-cutting requirements

### 8.1 Privacy — the load-bearing constraint

> **Nothing crosses a Family boundary. Ever.**

- **P1** Every table with Family-scoped data carries a `family_id` and an RLS policy keyed to the requesting Account's Membership.
- **P2** Every RLS policy has a **negative pgTAP test** asserting that a different Family's Account gets **zero rows**.
- **P3** `pending` Members can read **nothing**.
- **P4** Storage objects follow the same rule, verified by direct-URL test (§16.5).
- **P5** RLS is the enforcement mechanism, not a second layer behind application checks. See [ADR-0004](adr/0004-supabase-rls-boundary.md).

### 8.2 Data model invariants

Encode as constraints, not conventions:

| Invariant | Mechanism |
|---|---|
| A Member has exactly one of `account_id` / `guardian_account_id` | `CHECK` |
| A Board has exactly 25 Tiles at positions 0–24 | `UNIQUE (board_id, position)` + creation transaction |
| One Board per Member per Year | `UNIQUE (member_id, year_id)` |
| One Ballot per Member per vote | `UNIQUE (member_id, vote_id)` |
| Swaps used ≤ 3 | `CHECK` + trigger |
| Progress never exceeds what the log supports | Derived, never stored |

### 8.3 Time

- **T1** Every Family has an IANA timezone. Setup Window deadlines, freeze, and digests all resolve in it.
- **T2** All timestamps stored as `timestamptz` (UTC). Never `timestamp`.
- **T3** "Year" means the calendar year in the Family's timezone.

### 8.4 Accessibility

- **A1** The 5×5 grid must be navigable by screen reader — each Tile announces position, Goal, and progress.
- **A2** Completion state is **never** conveyed by color alone (checkmark or fill pattern too).
- **A3** Minimum 44×44pt touch targets — a 5×5 grid on a small phone is tight; do not let Tiles fall below this.

---

## 9. Definition of done

A slice is done when:

1. Its acceptance test passes on a real device or simulator.
2. Its pgTAP RLS tests pass, **including the negative cases**.
3. All previous slices' tests still pass.
4. Domain logic is unit-tested independently of the database.
5. `CONTEXT.md` has been updated if any new domain term appeared.
6. The work is committed with the slice number in the message.

---

## 10. Decision log

Every requirement above traces to a decision made during the scoping session.
The five that were hard to reverse, surprising, and genuinely contested got ADRs:

| ADR | Decision |
|---|---|
| [0001](adr/0001-personal-boards.md) | Boards are personal, not shared — and owned by Member, not Account |
| [0002](adr/0002-cumulative-goals-only.md) | Cumulative targets only; pace is advisory and never enforced |
| [0003](adr/0003-managed-child-profiles.md) | Children are Managed Members with no login |
| [0004](adr/0004-supabase-rls-boundary.md) | Supabase, with RLS as the Family privacy boundary |
| [0005](adr/0005-photo-attachments.md) | Photo Attachments are allowed, with the compliance cost accepted |
| [0006](adr/0006-wrapped-awards.md) | Wrapped may hand out Awards on unrelated axes — a bounded exception to the no-ranking rule |
| [0007](adr/0007-tied-family-goal-vote.md) | A tied Family Goal vote goes to the Organizer, then to the earliest Proposal — §9.2 and FRONTEND_DESIGN §4.3 disagreed |
