# Family Bingo — Frontend Design Spec ("Windowbox")

> **Audience: an implementing agent.** This is the visual half of the PRD. Where the PRD
> says *what* the app does, this says *what it looks like and how it behaves*. Section
> references like §12.1 point at the PRD.
>
> **Rule for the implementer:** the token table in §1 is the whole palette and the whole
> type scale. If you find yourself needing a colour or a size that isn't here, stop and
> ask — a one-off hex committed to a component is how a design system dies.

**Aesthetic:** japandi × plants. Warm paper, clay, moss, quiet type. The interface is
paper; the only thing that colours or moves is growth.

**Platform:** Expo (iOS + Android), light mode only in v1.

---

## 0. Principles

1. **The board is the product.** One screen, opened a hundred times a year. 25 tiles,
   always fully visible, never scrolled, never paginated.
2. **Quiet until it grows.** Colour and motion are reserved for progress. A single
   sprout should read from across a room.
3. **Nothing scolds.** There is no error colour, no "behind pace", no streak, no empty
   state that implies failure. A dormant tile looks identical whether it has been
   dormant four days or four months (§4.3, §7.5).
4. **An 8-year-old can drive it.** Every primary action is one tap on a target ≥ 44pt.
   State is legible without reading a word.

---

## 1. Tokens

Ship as a single module. Nothing outside this file defines a colour, radius, or duration.

```ts
// theme/tokens.ts
export const color = {
  // neutrals — warm, low chroma so member photos sit on them without clashing
  paper:        '#F3EEE3', // oklch(.95 .018 84)  app background
  paperRaised:  '#FBF7EF', // oklch(.98 .012 88)  cards, sheets, feed rows
  paperSunk:    '#E9E2D3', // oklch(.92 .018 84)  empty tile, wells, tracks
  hairline:     '#DDD4C2', // oklch(.88 .022 82)  1px rules, tile edge
  ink:          '#33302A', // oklch(.30 .012 75)  primary text        11.4:1 on paper
  ink2:         '#6E675C', // oklch(.52 .016 78)  secondary text       5.2:1 on paper
  ink3:         '#9C9385', // oklch(.66 .018 80)  decorative only      2.6:1 — never body

  // accent 1 — growth, completion, progress
  moss:         '#6D8659', // oklch(.58 .075 140)
  mossDeep:     '#4E6142', // oklch(.47 .066 140) any text on or of moss  7.0:1 on paper
  mossLight:    '#8AA173', // second leaf only
  mossTint:     '#DCE3D2', // oklch(.90 .028 140) progress fill behind the sprout

  // accent 2 — family & shared, and nothing else
  clay:         '#A3745C', // oklch(.58 .075 45)
  clayDeep:     '#7E5340', // oklch(.46 .07 45)   text on clay, seal ink
  clayTint:     '#EFE0D5', // oklch(.91 .026 45)  centre-tile ground, managed-member chip

  // accent 3 — the sunflower head at 'budding', and nothing else in the entire app
  sun:          '#C9A05A', // oklch(.72 .09 80)
} as const;

// Wrapped category breakdown ONLY (§20.5). Seven hue rotations at oklch(.87 .045 h).
// Never on a tile, never in the Feed. Do not add an eighth. Do not raise the chroma.
export const categoryTint = {
  fitness: '#C9DFC4', family: '#F2D8C9', health:   '#C6DFDD', learning: '#CFD8EF',
  money:   '#DCE0BE', creative: '#EDD3E4', other:  '#E6DCC3',
} as const;

export const font = {
  display: 'ShipporiMincho',      // SIL OFL 1.1 — bundled, not fetched
  ui:      'ZenKakuGothicNew',    // SIL OFL 1.1 — bundled, not fetched
} as const;

export const type = {
  display:  { family: font.display, size: 32, lineHeight: 38, weight: '500', letterSpacing: -0.3 },
  title:    { family: font.display, size: 24, lineHeight: 30, weight: '500' },
  cardHead: { family: font.display, size: 19, lineHeight: 26, weight: '500' },
  heading:  { family: font.ui,      size: 19, lineHeight: 26, weight: '700' },
  body:     { family: font.ui,      size: 16, lineHeight: 24, weight: '400' },
  label:    { family: font.ui,      size: 14, lineHeight: 20, weight: '500' }, // tabular numerals
  meta:     { family: font.ui,      size: 12, lineHeight: 16, weight: '500', letterSpacing: 1.2, textTransform: 'uppercase' },
} as const;

export const space  = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 44 } as const;
export const radius = { tile: 11, card: 12, sheet: 22, pill: 999 } as const; // Android: tile 12, sheet 28
export const motion = {
  tap:      { duration: 120, easing: 'ease-out' },
  grow:     { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' },
  complete: { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
  lineStep: { duration:  60 },
  reduced:  { duration: 150, easing: 'linear' }, // crossfade fallback for all of the above
} as const;
```

### 1.1 Rules that are not negotiable

- **There is no red.** No error colour exists in the palette. Destructive confirmations
  are `clayDeep` text on `paper` inside a `hairline` border. Failed uploads and offline
  state use `ink2` and plain words, never colour.
- **Clay means family.** The Centre Tile, the Family Goal, the Managed-Member indicator,
  and the Family aggregate cards. Nothing else may use it. `clayDeep` is also the
  sunflower's disc, which is the one exception and is purely optical — a warm dark reads
  as a seed head against both cream and ochre petals.
- **`sun` exists for one shape.** The sunflower head at `budding`. Never a button, never
  a highlight, never a chart. A board with one tile at 94% must have exactly one warm
  mark on it.
- **`ink3` is decorative.** Dividers, placeholder glyphs, timestamps in `meta`. Never
  content a Member wrote, never a label they need to read.
- **Type sizes come from `type`.** Shippori Mincho is never used below 19pt and never on
  a control — no buttons, no tabs, no labels, nothing a finger touches.

### 1.2 Dark scheme

Not an inversion. Neutrals flip, accents **lift**, and one token changes job.

```ts
export const dark = {
  paper:       '#1B1917', paperRaised: '#24211E', paperSunk: '#131110',
  hairline:    '#35302A',
  ink:         '#F0EADF', // 14.6:1   ink2: '#A9A092' 6.6:1   ink3: '#6F675B'
  ink2:        '#A9A092', ink3: '#6F675B',
  mossInk:     '#7E9868', // stems, leaves, moss-coloured text — replaces mossDeep
  moss:        '#6D8659', // UNCHANGED: completed tiles read as lit, not filled
  mossTint:    '#2B3326',
  clay:        '#B98A70', clayTint: '#3A2B23',
  sun:         '#D2A961',
} as const;
```

- **`mossDeep` has no job in dark.** Ship `color.mossInk` as one scheme-resolved token or
  every component grows its own conditional.
- **The stem goes to 2.5px in dark.** A 2px `#6D8659` hairline disappears on charcoal.
  The seed lifts to `ink3`; the flower's disc lifts to `#4A3325`.
- **No pure black**, including `paperSunk`. A lamp-lit room, not a void.
- **Elevation is lightness, never shadow.** Sheet scrim goes 35% → 55%.
- **Images carry a 1px `hairline` inset in dark** and the loading hatch drops to 5% white.
- **Wrapped has no dark mode** — its cards are already their own grounds (§3).
- **Still no red.** Destructive confirm is `#B98A70` on `#35302A`.
- Default `Match the phone`; Light/Dark override lives in Account, per handset. No timed
  switch, no per-Family override.

---

## 2. The growth ladder

The single most important piece of visual logic. Derived from
`COUNT(increments) / target` on every render — **never a stored flag** (§12.1).

```ts
// domain/growth.ts — pure, no imports, unit-test exhaustively
export type Stage = 'dormant' | 'seeded' | 'sprouting' | 'budding' | 'complete';

export function stageOf(count: number, target: number): Stage {
  if (count >= target) return 'complete';
  if (count <= 0)      return 'dormant';
  const p = count / target;
  if (p < 0.18) return 'seeded';
  if (p < 0.82) return 'sprouting';
  return 'budding';
}

/** Continuous 0–1 used for fill height and stem length. Clamped — never exceeds 1. */
export function progressOf(count: number, target: number): number {
  return Math.min(1, Math.max(0, count / target));
}
```

| Stage | Range | Rendering |
|---|---|---|
| `dormant` | 0% | Empty `paperSunk` well, `hairline` inset border. Nothing else. |
| `seeded` | 1–17% | `mossTint` fill at `progress`. A 9×12 `ink3`-toned seed (border-radius 50%) resting on the soil line. |
| `sprouting` | 18–81% | Fill + a 2px `moss` stem, height `7 + progress*20`. **One** `moss` leaf on the left, and only ever one. |
| `budding` | 82–99% | The head opens at the stem tip: an 18pt sunflower in `sun` with a `clayDeep` disc, narrow petals (26° of every 45°). Stem and leaf stay. The only warm marks on an unfinished board. |
| `complete` | 100% | **Stem and leaf fall away.** Solid `moss` tile + a 27pt centred sunflower with `paper` petals (wide, 32° of every 45°) and a `clayDeep` disc + `paper` check, top-right + a 1px/7px diagonal hatch at 10% white. |

The petals widen from budding to complete — 26° → 32° — so the flower reads as *opening*
rather than simply changing colour. That is the whole animation (§5, "Complete").

**One leaf, always.** A second mirrored leaf was tried and removed: at tile scale it
never reads as a pair, it competes with the flower head at 82%, and it doubles the
number of things that have to stay attached to a 2pt stem.

**Leaf glyph** — no SVG, no asset:
`{ width: n, height: n, backgroundColor: moss, borderRadius: [100%, 0, 100%, 0], transform: rotate(-15deg) }`

**The leaf is positioned against the stem, never against the tile.** This is the one
geometry rule in the system that is easy to get wrong and obvious when it is. Derive
both values from the stem so contact is structural:

```ts
const stemH = 7 + progress * 20;              // stem sits 9pt above the tile floor
const leaf  = clamp(Math.round(stemH - 1), 9, 12);
const leafBottom = 9 + (stemH - leaf) / 2;    // leaf is centred within the stem's span
// horizontally: left 50%, translateX(-9) — the leaf's inner edge always crosses the stem
```

Centring the leaf inside the stem's own span guarantees it touches at every progress
value **and** that its top clears the flower head at 82%, where the head's bottom is
`12 + progress*20`. Never give the leaf an independent `bottom` curve — one that
outruns the stem is exactly how it ends up floating.

**Sunflower glyph** — two views, no SVG, no asset. On web/CSS it is a single element:

```css
/* petals: 8 sectors, 45° period. petalWidth 26deg = budding, 32deg = complete */
border-radius: 50%;
background: repeating-conic-gradient(from 22.5deg,
            <sun|paper> 0deg <petalWidth>, transparent <petalWidth> 45deg);
/* disc: a child at inset 29%, borderRadius 50%, backgroundColor clayDeep */
```

React Native has no `conic-gradient`. Implement `<Sunflower size petalColor petalSpread />`
as **8 `<View>` petals** — each `width: size*0.42`, `height: size*0.20`,
`borderRadius: size*0.10`, absolutely centred and `rotate(i * 45deg) translateX(size*0.29)` —
plus the disc on top. Rounded petals are the better shape anyway; the conic version is the
web approximation, not the reference. Memoise it: it renders 25 times per board.

**Leaves are for growing, the flower is for arriving.** No screen shows both a leaf and a
completed tile's flower in the same glyph. Do not add a leaf to the completion mark to
"balance" it.

**Past 100% nothing happens.** 160 of 150 renders exactly as 150. Overshoot is
celebrated once, in Wrapped (§20.4) — never on the board, where it would quietly
re-introduce a ladder that §13.5 forbids.

---

## 3. Component contracts

### `<Tile>`

| Prop | Type | Notes |
|---|---|---|
| `position` | `0–24` | Row-major (§5.4). Row `p/5`, column `p%5`. |
| `goal` | `Goal \| null` | `null` = an unfilled Tile on a sealed Board — renders `dormant` with a `hairline` dashed border and no glyph. |
| `count` | `number` | `COUNT(increments)`. Never a cached field. |
| `isCentre` | `boolean` | `position === 12`. |
| `centreMode` | `'shared' \| 'personal'` | `shared` → `clayTint` ground, 1.5px `clay` inset border, clay dot top-centre. `personal` → renders like any other tile. |
| `onPress` | `() => void` | Opens the tile sheet. Never logs an increment directly — one-tap logging lives in the sheet, so a mis-tap on a 67pt target in a pocket can't write a row. |

Square via `aspectRatio: 1`, `overflow: hidden`, `borderRadius: radius.tile`.
Accessibility label order: **position, goal, progress, state** — see §6.

### `<Board>`

`display: grid`, 5 columns, `gap: 7` (iOS) / `8` (Android), horizontal padding `20` /
`16`. Yields 66.8pt at 402pt and 70dp at 412dp; 61.4pt at the 375pt floor (iPhone SE).
**Never scrolls, never shrinks, never paginates.** If content below it doesn't fit, the
content scrolls under a pinned board — not the other way round.

Line state renders as a 12-segment pip row beneath the board (5 rows, 5 columns, 2
diagonals, in the constant order of §13.1). Completed segments are `moss`; the rest
`paperSunk`. No count is displayed larger than `label` size — this is a fact, not a score.

### `<TileSheet>`

Detented bottom sheet, `radius.sheet` top corners, board dimmed to 35% behind.

- **Ring** — 92pt conic ring, `moss` on `paperSunk`, `count` at 23pt/700 and
  `of {target}` at 11pt inside. This is the one place the exact number appears large.
- **Primary action** — 56pt `moss` button, `paper` text at 17pt/700, verb phrased from
  the goal's unit ("Walked one", "Read one", "Did it" when `unit` is null). One tap,
  optimistic, haptic on touch-down (§11.1, §17.2).
- **Secondary** — "Add a note" / "Add a photo", 46pt, hairline outline. Optional, always
  (§11.1). Never required, never pre-focused.
- **Recent** — last three Increments, date + note. Notes are `body`; "No note" is `ink3`.
  Deleting an Increment is the only mutation (§11.3) — swipe, `clayDeep` label, no red.
- **When it cannot log**, the actions are replaced by one `label` line in `ink3`, and the
  reason decides the sentence — a single "can't log" flag once told an owner looking at
  their own frozen Board that only that member could log there. Three reasons: the Year is
  finished; the Board belongs to somebody else; or the Board has sealed and the Year has
  not begun yet (PRD §22.5), which is the opposite of the first and reads "Your board is
  set — play opens in 9 days." A Swap is still offered in that last case: the Board is a
  commitment already, and refusing both would leave a typo untouchable for a fortnight.

### `<FeedRow>`

One row per event, reverse chronological, `hairline` divider between. 34pt leading slot:

| Event | Leading | Treatment |
|---|---|---|
| Increment | Member avatar (circle) | `paperRaised`. Note in `body`, photo below at 150pt, `radius.card`. |
| `tile_completed` | `moss` rounded square + 20pt paper sunflower | **`mossTint` row background**, top and bottom `#C8D2BC` border. The only tinted row type. |
| `bingo` / `blackout` | `clay` seal (2px inset frame + clay leaf) | `paperRaised` background, headline in `cardHead` (Shippori). |
| Swap | `paperSunk` square + minus bar | Old text struck through in `ink3`, new text in `ink` 700. Remaining budget in `meta`. |
| Member joined | Empty avatar circle | 75% opacity. |

Managed Members carry a 11pt `clay` dot on the bottom-right of their avatar, everywhere
they appear. Actions are attributed to the **Managed Member**, never the Guardian (§4.2)
— but the dot makes the relationship visible without naming the Guardian in the row.

Photos are `<Image>` from a **signed URL with a short TTL** (§16.2). Placeholder while
loading is `paperSunk` with a diagonal hatch — never a spinner, never a blur-up of a
cached child's face.

### `<WrappedCard>`

Full-bleed, swipeable, 6-segment progress rail at the top (`paper` on the dark card,
`ink` on light). Two grounds only:

- **Personal cards** — `mossDeep` ground, `paper` text. The big numeral is Shippori at
  118pt/.9 line height. One number per card; supporting stats in a 2×2 hairline grid.
- **Family, Awards, Final** — `paper` ground, `ink` text. The Family Goal outcome sits
  in a `clayTint` block.

Awards render as a flat list of four-plus rows: avatar, award name in `cardHead`, one
line of `ink2` explanation. **No ordering, no numbering, no "1st".** Every Member appears
at least once (§20.7) — if the natural winners leave someone out, assign from the
unclaimed axes before rendering.

The final card is not a stat: "Ready for {year}?", 25 empty tiles, and a `moss` button
straight into opening the next Year (§20.6).

---

## 4. Screen specs

| Screen | Notes |
|---|---|
| **Sign in** | Centred 5×5 of `paperSunk`/`mossTint` tiles as the mark. Wordmark in Shippori 38pt. Three passwordless buttons, 52pt, 10pt apart: Apple (`ink` filled), Google (`paperRaised` outlined), magic link (text only). Footer: "No passwords. Not now, not later — there's nothing to forget." |
| **Home (no Family)** | Two 52pt options — Create a Family / Join a Family — and nothing else. This is Slice 2's landing state. |
| **Board** | Family switcher chip (14pt/500 `ink2` + chevron) top-left, account avatar top-right. Member strip: 44pt avatars, active gets a 1.5pt `moss` ring with a 2pt paper gap. Title `display`, meta line `label` in `ink2`. Board. Milestone card (`paperRaised`, `radius.card`). Line pips. Tab bar. |
| **Feed** | `display` title, `Family · Year` in `label`. Rows per §3. Paginated, newest first, one Family, one Year (§14.1). |
| **Wrapped** | Horizontal pager, one card per screen, no chrome except the rail. Generated once at freeze and materialised (§20.2) — the client reads a single row and renders instantly. |
| **Authoring** | The drafting table and the compose screen — §4.1. |
| **Sharpening** | Three states, none of them blocking — §4.2. |
| **The Centre** | Proposals, vote, and the sealed shared tile — §4.3. |
| **Swap** | One confirm sheet, then compose — §4.4. |

**Copy voice:** warm, brief, occasionally funny, never coachy. "11 lines left. Nobody's
counting." is right. "You're on track!" is wrong. Never congratulate effort the app
can't see, never imply a Member is behind.

### 4.1 Authoring

A Member writes 24 Goals; the 25th square is the Centre (§4.3). Authoring is a **list,
not a grid** — a 66.8pt tile cannot hold a sentence, and the board isn't drawn until it
seals.

- **Drafting table** — `display` title, `label` meta ("17 of 24 · the board seals in 6
  days"), a 24-pip written/unwritten strip in `ink3` on `paperSunk`, the Centre card in
  `clayTint`, then the written Goals in a hairline-divided list: `DM Mono` index in `ink3`,
  goal in `body`, target + `pace_hint` in `meta`.
- **The footer is one control at a time**, and which one is a fact about the Board rather
  than a choice (PRD §22):
  - **Not yet full** — 56pt `moss` "Write another", over "n still empty" in `ink3`.
  - **Full, not declared** — 56pt `moss` "I'm done", which opens a `<ConfirmSheet>` saying
    what the tap does: whether it seals the whole Family now, and that the Centre is then
    decided on the votes cast. There is still no "Seal the board" — a Member declares
    their own Board finished and never anyone else's.
  - **Declared** — "Your board is done · waiting on Ada" in `body`, over a `text` "Actually,
    I'm still writing". Revocable until the Boards seal (§22.4).
- **A sealed Board whose Year has not started** says so instead of counting down to
  nothing: "This board is set — play opens in 9 days. Changing a goal now costs a swap."
  Sealing and the start of the Year are two moments (§22.5), and only the second one makes
  a square tappable.
- **The pips are never `moss`.** Writing a goal is not growth. Reserve the accent for the
  ladder or the board stops meaning anything.
- **One goal** — full screen, keyboard up. Free-text field at 22pt/400 Zen Kaku (never
  Shippori on a control), optional 46pt "Sharpen it", and a target stepper defaulting to 1
  with the resulting increment verb previewed beside it ("once · the button will say 'Did
  it'"). **Every saved Goal has a target** — `stageOf` is meaningless without one.
- **Order is not priority.** The list stays in the order written; positions are dealt at
  seal, so no Member can place the easy one in a corner.

### 4.2 Sharpening (§7.9)

One suggestion, never a menu of rewrites, and the Member's own sentence always sits
beside it as an equal card.

| State | Rendering |
|---|---|
| Working | `ink3` "Sharpening…" pill. **Save stays enabled** — the Member can save and leave before the model answers. No overlay, no disabled control. |
| Answered | **One call per Goal, no reroll.** Two selectable cards — `SHARPENED` (`moss` 1.5px inset + `moss` check when chosen, `cardHead` text, target and `pace_hint` as chips) and `AS YOU WROTE IT` (hairline, `body` in `ink2`). One 56pt `moss` "Save this goal"; "Sharpen it again" is a 44pt text row below it. |
| Refused / slow / malformed | Text saved verbatim, said plainly in `ink2`: "Saved as you wrote it." No red, no retry modal, no dead end. A failed call **does not spend** the Goal's sharpen. |

The sharpener may propose **text, target and unit**. It may never write an Increment,
alter a saved Goal, or reorder the list. Nothing is pre-selected on the Member's behalf.

**One sharpen per Goal**, spent only on a successful response. Both cards stay editable by
hand afterwards, so refinement is manual, not another model call. This is a product rule,
not a cost control: a rerollable sharpener turns writing a goal into a slot machine.

### 4.3 The Centre

The shared square is proposed and voted on before the Board seals.

- **Vote screen** — `clayTint` explainer block with the centre-tile glyph, then proposals
  as `paperRaised` cards **in the order they arrived**. They do not re-sort as votes land.
  Your vote is a 1.5px `clay` inset plus a `YOUR VOTE` pill; other votes are 22pt voter
  avatars, right-aligned. Zero votes reads "No votes yet" in `ink3` — never "0".
- **One vote each, movable** until seal, Managed Members included (a Guardian never gets
  two). Moving a vote writes no Feed row.
- **Ties go to the earliest proposal.** Deterministic, explainable to a child, no runoff
  screen. The outcome is stated as a fact, never as a defeat.
- **Sealed tile** — `TileSheet` with two changes: the ring track is `clayTint` (the fill
  stays `moss`; progress is always `moss`), and the increment verb is the app's only plural
  — "We did it". Contributors render as faces in join order inside a `clayTint` block:
  **no counts, no ordering** (§13.5). Recent rows are attributed by Member name, since the
  tile is shared.

### 4.4 Swaps

**Three per Member per year**, refilled when the next Year opens.

- **Confirm sheet** — `meta` position line, `title` "Swap this goal?", the outgoing Goal in
  a hairline card with its live tile glyph and `count of target`, one paragraph of plain
  copy about what happens to the logged Increments, a 3-pip budget row on `paperSunk`, then
  the confirm: **`clayDeep` text on `paper` inside a hairline border** (§1.1 — this is the
  destructive-confirm treatment, and it is the only place in the app that uses it).
  "Keep it" is a 52pt text row below.
- **Spent on write, not on open.** The budget decrements when the new Goal is saved.
- **Not swappable:** the Centre, and any Tile already `complete`. Everything else is fair
  game at any point in the Year, including a Tile at 97%.
- **The record is never rewritten.** The retired Goal keeps its Increments; they still
  count in Family totals and surface in the Almanac as "goals you set down". The Tile
  resets to `dormant` because `COUNT(increments)` on the *new* Goal is zero — not because
  anything was deleted.
- A Guardian swapping for a Managed Member spends **that Member's** budget, and the Feed
  row is attributed to the Member (§4.2).

### 4.5 Family creation and joining

- **Create** — one field. Name only; year, timezone and board size are product decisions,
  not a form. 56pt `moss` "Create it".
- **Invite** — the code in `DM Mono` at 30pt / .16em on a `paperRaised` card, a 56pt `moss`
  "Share the link", then the roster: joined Members are avatars, invited-not-joined are
  hairline rings at 75% with "invited" in `meta`. Never a red "pending" badge, never a
  resend nag. **Code alphabet excludes O, 0, I and 1** — it gets read aloud across a room.
  No contacts permission, no directory, no discovery by phone number.
- **Join** — the 5×5 mark, one sentence naming the inviter and the Family, the faces
  already in it, 56pt `moss` join, "Not now" as a text row. Any deadline copy is factual
  and never conditional ("2028 opens in six days" — not "hurry").
- **20 Members to a Family, and 20 invitations.** Seats render as a pip row on
  `paperSunk` ("4 of 20. Sixteen invitations left.") — pips, never a progress bar, because
  twenty fit on one line and nobody should read a fraction.
- **At capacity:** "Share the link" drops to the disabled hairline treatment and the code
  card dims to `ink3` — still legible, since it's how the existing Members arrived. The pip
  row reads "20 of 20. Full for now." **Outstanding invitations remain valid** — a code
  already sent is a promise. No upgrade offer, ever. Removing a Member re-enables it.
- Joining mid-Year is normal: the Member writes their 24 and starts where the Year is.
- **The board header's avatar strip scrolls horizontally past 8.** Full-bleed (negative
  margin + matching padding so avatars pass under the screen edge), no scrollbar, snap off.
  It never truncates to "+12" — that counts people (§2 of the do-nots).
  Built in PRD §23 as `<MemberStrip>`. Three rules the component holds that this paragraph
  did not say: it carries **faces and names only** — no ring, no count, ever, because a row
  of avatars each wearing a completion ring is the ladder do-not #2 forbids however it is
  ordered; it appears **only on a drawn Board**, since PRD §23.2 keeps a Board private
  until it seals; and a Member whose Board has not sealed is **dimmed and inert rather than
  absent**, for the same reason "+12" is refused.
- **A roster row on the Family screen opens that Member's Board** (PRD §23.3) — the entry,
  where the strip is the traverse. Face and name are the tap target; Remove and Let in stay
  siblings of it rather than children. Under the name: the role, then where their Board has
  got to — "still writing" / "board done" during the Setup Window, "no board for 2026" for
  a Member who arrived after that Year opened. Never a count.

### 4.6 Account

Ordered by how often it's needed: **Families → people you look after → this handset**.
Rows are hairline-divided `body`, values in `ink3`. Sign out is a plain text row.
**Delete my account** is the `clayDeep`-on-hairline treatment at the bottom, with the
consequence stated *above* the tap — boards leave every Year including frozen ones, the
Family keeps theirs, Managed Members transfer. No modal that says the same thing again.

### 4.7 Managed Members

The setup sheet states the whole contract before the button, in three `clay`-bulleted
lines, because these are the rules a Guardian is agreeing to:

1. **Attribution** — the Feed says the Member's name; the `clay` dot is the only sign the
   Guardian tapped it (§4.2).
2. **Privacy** — name and face never leave the Family; Almanac exports are stats only.
3. **Handover** — when they get a phone, the member transfers whole: same board, same
   Year, same tiles, dot removed. Design for this on day one; it is the exit everybody
   eventually takes.

Managed Members receive no notifications and cannot be sent an invite.

### 4.8 Notifications

Five switches, all of them somebody else's news: tile completed, bingo/blackout, the
Centre moves, swaps (off by default), the Almanac. Plus quiet hours (21:00–07:00,
batched into one line at 07:00).

- **There is no daily reminder** — not off by default, *absent*, and the settings screen
  says so. This is §3 expressed as a preference list.
- **Every string names the Member and the thing.** Never "someone in your family".
- **Never count what the reader hasn't done**, never name a Member who hasn't logged,
  never end on a question, never send anything about a Member's own inactivity.
- A tap opens the Tile the notification is about, not the app.
- Nothing is ever sent on behalf of a Managed Member.

---

## 5. Motion & haptics

Four bespoke animations. Screen transitions are platform default and unstyled.

| Name | Duration | What |
|---|---|---|
| **Tap** | 120ms | Tile scales 1 → 0.96 → 1, `ease-out`. Fires on touch-down, not on server response. |
| **Grow** | 320ms | Fill height and stem length animate together, `cubic-bezier(.2,.8,.2,1)`. A newly-crossed leaf threshold fades in over the last 120ms. |
| **Complete** | 520ms | `moss` wipes upward from the soil line; stem and leaf fade beneath it; the head travels to tile centre, scales 18 → 27pt and its petals widen 26° → 32° as it opens; check stamps in at 380ms. Fires **once per Tile, ever** (§12.2) — gate on the milestone insert, not on `count >= target`, or an offline replay re-fires it. |
| **Line** | 5 × 60ms | The five tiles pulse in sequence along the line's direction (diagonals corner to corner), then a 1px `clay` hairline draws through them. |

Haptics: `light` on increment (both platforms) · `success` / `CONFIRM` on tile complete ·
five `light` impacts 60ms apart on Bingo.

**Reduce Motion:** all four collapse to a 150ms crossfade between start and end state.
**Haptics stay** — they carry the reward and they are not motion.

---

## 6. Accessibility

- **A1** Each Tile is one focusable element. Label order: position, goal, progress,
  state. *"Row 2, column 1. Walk a mile. 96 of 150. In progress."* Position first — a
  Member navigating by swipe needs to know where they are before what it is.
- **A2** Completion carries four independent cues: fill, silhouette, check, hatch. Test
  by desaturating a board screenshot; if you can't count the finished tiles, it fails.
- **A3** 44pt (iOS) / 48dp (Android) minimum. The board's own geometry gives 66.8pt at
  402pt and 61.4pt at the 375pt floor.
- **A4** Dynamic Type to XXL everywhere except the board, which caps at L. The tile
  sheet carries the full range, so larger text is always one tap away.
- **A5** A completed Line announces once, on the tile that closed it — *"Bingo. Row 2
  complete."* — not five times.
- **A6** Every Increment button has an explicit accessible label including the goal
  text. "Walked one" alone is meaningless out of context.

---

## 7. Do not

1. **Do not introduce a colour**, including a red for errors or a gold for awards. `sun`
   is not available for reuse — it is the sunflower's, and it only works because it is
   rare.
2. **Do not rank Members visually.** No ordered lists, no position numbers, no "first
   to bingo", no sorting the member strip by progress. Alphabetical or join order only
   (§13.5). Awards are the single bounded exception and are never numbered (§13.5a).
3. **Do not add a streak, a calendar heatmap, or a "days since"** anywhere. §4.3 is a
   product decision and this is where it would leak back in.
4. **Do not render `pace_hint` anywhere a calculation could be inferred from it.** It is
   display-only text and nothing may branch on it (§6.3).
5. **Do not draw the board with SVG or images.** It renders 25 times on every launch;
   views and border-radius are cheaper and themeable.
6. **Do not use a public Storage bucket or a long-lived URL for a photo**, and do not
   cache a photo to disk outside the app's private container (§16.2).
7. **Do not put a Managed Member's name or face in anything shareable.** The Share
   button on Wrapped exports the Member's own card, stats only (§20.9).
8. **Do not block on Sharpening.** If the model is slow, refuses, or returns malformed
   JSON, save the Member's text as written and say so plainly (§7.9).
9. **Do not sort Centre proposals by votes**, live or at rest, and do not show a vote
   count as a numeral. Rule 2 above applies to proposals, because a proposal has an author.
10. **Do not delete an Increment on swap**, and do not let any screen imply a Member gave
    up on the goal they set down.
11. **Do not add a reminder, a nudge, or a re-engagement push**, in any form, under any
    name, in any experiment.
12. **Do not theme Wrapped for dark mode**, and do not let an error colour in through it.

---

## 8. IP notes

Everything in this system is authored here or openly licensed. Keep it that way.

**Safe:** the warm-neutral palette (an aesthetic tradition, not an asset) · the leaf,
seed, sprout, sunflower, ring and seal (geometric primitives drawn in code — the
sunflower is eight rounded rectangles and a circle, not an illustration of any
particular one) · Shippori Mincho and
Zen Kaku Gothic New (SIL OFL 1.1, free for commercial use and embedding — bundle the
files and ship the licence text in your acknowledgements screen) · the growth metaphor
(an idea) · "Bingo" (a generic game name, public domain).

**Never ship:** any character, creature, mascot or blob resembling one from an anime or
game · any spirit / forest-god / soot-sprite figure, however abstracted · an RPG
"status window" layout quoting a specific series · illustration in a recognisable
studio's house style, **including AI-generated in-the-style-of** · any typeface with a
bespoke or restricted licence · stock art whose licence excludes app-store distribution.

**Two naming flags before a public listing:**
1. **"Wrapped"** is strongly associated with another company's annual-recap product.
   Keep it as the internal term if you like — it's unambiguous in the codebase — but
   ship it under a different name. *The Almanac* fits this system better anyway.
2. **"Family Bingo"** is descriptive and almost certainly unregistrable as a mark.
   That's fine for v1, but it also means you can't stop anyone else using it. Worth a
   clearance search before you spend money on the icon.

If you later commission an illustrator: brief them on this system's primitives, never on
a reference film; take a work-for-hire assignment of copyright in writing; and get a
warranty that no generative tool was trained or prompted on a named artist's or studio's
work. The only place illustration earns its keep is the Wrapped cards. The board stays
code, forever.

---

*Companion file: `Family Bingo — Windowbox.dc.html` — the visual spec, three board
directions, and every screen above rendered on device.*
