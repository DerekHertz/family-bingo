/**
 * The whole palette and the whole type scale (FRONTEND_DESIGN §1).
 *
 * > If you find yourself needing a colour or a size that isn't here, stop and ask — a
 * > one-off hex committed to a component is how a design system dies.
 *
 * Nothing outside this file defines a colour, radius, or duration. Three rules from §1.1
 * are worth repeating where they will be read:
 *
 *   - **There is no red.** No error colour exists. Destructive confirmations are
 *     `clayDeep` on `paper` inside a `hairline` border; failed uploads and offline state
 *     use `ink2` and plain words.
 *   - **Clay means family**, and nothing else: the Centre Tile, the Family Goal, the
 *     Managed-Member dot, the Family aggregate cards.
 *   - **`sun` exists for one shape** — the sunflower head at `budding`. A board with one
 *     tile at 94% must have exactly one warm mark on it.
 */

export const color = {
  // Neutrals — warm, low chroma so member photos sit on them without clashing.
  paper: '#F3EEE3',
  paperRaised: '#FBF7EF',
  paperSunk: '#E9E2D3',
  hairline: '#DDD4C2',
  ink: '#33302A', //  11.4:1 on paper
  ink2: '#6E675C', //   5.2:1 on paper
  ink3: '#9C9385', //   2.6:1 — decorative only, never body text

  // Accent 1 — growth, completion, progress.
  moss: '#6D8659',
  mossDeep: '#4E6142', // 7.0:1 on paper; any text on or of moss
  mossLight: '#8AA173', // second leaf only
  mossTint: '#DCE3D2',

  // Accent 2 — family and shared, and nothing else.
  clay: '#A3745C',
  clayDeep: '#7E5340',
  clayTint: '#EFE0D5',

  // Accent 3 — the sunflower head at 'budding', and nothing else in the entire app.
  sun: '#C9A05A',

  /**
   * The top and bottom edge of the Feed's one tinted row (§3 `<FeedRow>`).
   *
   * > `tile_completed` … **`mossTint` row background**, top and bottom `#C8D2BC` border.
   * > The only tinted row type.
   *
   * §3 names this hex and §1's table does not, which is not a contradiction: it is
   * `mossTint` one step darker, and it exists so the one row type that carries a
   * background does not float. It has exactly one job — do not reach for it as a general
   * moss border, and do not put it on a second row type.
   */
  mossTintEdge: '#C8D2BC',

  /**
   * Behind a sheet: the board dimmed to 35% (§3 `<TileSheet>`).
   *
   * `ink` at 35%, as a token rather than an `rgba()` written into a component — a literal
   * there is a light-mode colour that can never flip, and `dark` carries its own.
   */
  scrim: 'rgba(51, 48, 42, 0.35)',

  /**
   * §2's 1px/7px diagonal hatch over a completed Tile — 10% white on solid `moss`.
   *
   * Here for the same reason `scrim` is, and it was the last `rgba()` left inside a
   * component. It is also load-bearing rather than decorative: §6 A2 says completion
   * carries **four** independent cues — fill, silhouette, check, hatch — tested by
   * desaturating a board screenshot, and fill and silhouette are both colour, so the hatch
   * and the check are what survive that test.
   *
   * Absent from `dark` on purpose, like `moss` itself: §1.2 keeps completed tiles reading
   * as lit rather than filled, so white over the same moss is the same mark. (§1.2's drop
   * to 5% is the *loading* hatch behind a photo, which is a different hatch on
   * `paperSunk`.)
   */
  completionHatch: 'rgba(255, 255, 255, 0.1)',
} as const;

/**
 * Dark is not an inversion (§1.2): neutrals flip, accents lift, and one token changes job.
 *
 * `moss` is deliberately unchanged so completed tiles read as lit rather than filled, and
 * `mossDeep` has no job here at all — `mossInk` replaces it, shipped as one resolved token
 * so no component grows its own conditional.
 */
export const dark = {
  paper: '#1B1917',
  paperRaised: '#24211E',
  paperSunk: '#131110', // no pure black, including here: a lamp-lit room, not a void
  hairline: '#35302A',
  ink: '#F0EADF', // 14.6:1
  ink2: '#A9A092', //  6.6:1
  ink3: '#6F675B',
  mossInk: '#7E9868',
  moss: '#6D8659',
  mossTint: '#2B3326',
  clay: '#B98A70',
  clayTint: '#3A2B23',
  sun: '#D2A961',
  /** Darker than light's, because a dim room needs more separation, not less. */
  scrim: 'rgba(0, 0, 0, 0.55)',
} as const;

/**
 * Wrapped's category breakdown ONLY (§20.5). Seven hue rotations at oklch(.87 .045 h).
 * Never on a tile, never in the Feed. Do not add an eighth. Do not raise the chroma.
 */
export const categoryTint = {
  fitness: '#C9DFC4',
  family: '#F2D8C9',
  health: '#C6DFDD',
  learning: '#CFD8EF',
  money: '#DCE0BE',
  creative: '#EDD3E4',
  other: '#E6DCC3',
} as const;

/** Both SIL OFL 1.1 — bundled, never fetched (§8). */
export const font = {
  display: 'ShipporiMincho',
  ui: 'ZenKakuGothicNew',
  /** §4.5's Invitation code, and nothing else. Also SIL OFL. */
  mono: 'DMMono',
} as const;

/**
 * Shippori Mincho is never used below 19pt and never on a control — no buttons, no tabs,
 * no labels, nothing a finger touches (§1.1).
 */
export const type = {
  display: {
    fontFamily: font.display, fontSize: 32, lineHeight: 38, fontWeight: '500',
    letterSpacing: -0.3,
  },
  title: { fontFamily: font.display, fontSize: 24, lineHeight: 30, fontWeight: '500' },
  cardHead: { fontFamily: font.display, fontSize: 19, lineHeight: 26, fontWeight: '500' },
  heading: { fontFamily: font.ui, fontSize: 19, lineHeight: 26, fontWeight: '700' },
  body: { fontFamily: font.ui, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  /**
   * The one goal being written (§4.1): 22pt/400 Zen Kaku, never Shippori — Shippori is
   * never used on a control, and a field a finger lands in is a control.
   */
  compose: { fontFamily: font.ui, fontSize: 22, lineHeight: 30, fontWeight: '400' },
  label: { fontFamily: font.ui, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  /** The Invitation code (§4.5): 30pt, .16em. */
  code: { fontFamily: font.mono, fontSize: 30, lineHeight: 38, letterSpacing: 4.8 },
  /**
   * The drafting table's goal numbers (§4.1, "`DM Mono` index in `ink3`").
   *
   * The second and last monospace in the app, and it is the same reason as the first: a
   * column of numbers read down a list has to align, and a proportional face will not.
   * Not `code` at a smaller size — 4.8pt of letterSpacing is right for eight characters
   * read aloud across a room and wrong for a two-digit index.
   */
  index: { fontFamily: font.mono, fontSize: 13, lineHeight: 20 },
  meta: {
    fontFamily: font.ui,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  /**
   * The count inside the tile sheet's ring (§3): 23pt/700.
   *
   * The largest number anywhere in the app, and the only one — §3 calls the sheet "the one
   * place the exact number appears large", because a Member is looking at their own Goal
   * and nobody else's. The same size on a screen that shows two Members would be a score,
   * which §13.5 forbids. Do not reuse this token outside the ring.
   */
  ringCount: { fontFamily: font.ui, fontSize: 23, lineHeight: 28, fontWeight: '700' },
  /** "of 144" beneath it (§3): 11pt, and deliberately not `meta` — no caps, no tracking. */
  ringOf: { fontFamily: font.ui, fontSize: 11, lineHeight: 15, fontWeight: '500' },
  /**
   * Wrapped's one big number (§3 `<WrappedCard>`): Shippori at 118pt on a .9 line height.
   *
   * The largest thing in the app by a factor of four, and it is allowed to be exactly
   * because of *when* it appears. A number this size on a live screen would be a score, and
   * §13.5 forbids one; a number this size on a card revealed once, after the Year is already
   * decided, only describes what happened (ADR-0006). One per card, on a Member's own stats
   * and never on a comparison — do not reuse this token anywhere else.
   *
   * The line height is below the size on purpose: at 118pt the font's own leading opens a
   * gap wide enough to push the supporting grid off a small handset.
   */
  wrappedNumeral: {
    fontFamily: font.display, fontSize: 118, lineHeight: 106.2, fontWeight: '500',
    letterSpacing: -2,
  },
  /**
   * The tile sheet's primary action (§3): 17pt/700 on a 56pt `moss` button.
   *
   * Not `heading`, which is 19pt — close enough to look deliberate and wrong by two
   * points on the one control a Member presses more than any other.
   */
  action: { fontFamily: font.ui, fontSize: 17, lineHeight: 22, fontWeight: '700' },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 44 } as const;

/**
 * Sizes §4 states directly, so no screen has to invent them.
 *
 * `control` is the button and field height from §4's sign-in row; `minTouch` is §6 A3's
 * floor and nothing may go under it. `stack` is the 10pt the three sign-in buttons sit
 * apart. `wordmark` is the 38pt Shippori on that screen — the one display size not in the
 * type scale, because it is used once.
 */
export const size = {
  control: 52,
  /** §4.5's "Create it", and every primary action that commits something. 56pt, moss. */
  controlPrimary: 56,
  /**
   * §4.1's "Sharpen it" — 46pt, between a control and a text row.
   *
   * The size is the point: asking for a suggestion is optional and must never look like
   * the way forward. Below the 52pt of a real control, above the 44pt floor a finger
   * needs (§6 A3).
   */
  controlSharpen: 46,
  /** Below the header on a full screen. Clears the status bar without a safe-area hook. */
  screenTop: 72,
  minTouch: 44,
  stack: 10,
  /** The clay bullet and the Managed-Member dot. One dot size, not three. */
  dot: 7,
  formWidth: 340,
  proseWidth: 300,
  wordmark: { fontSize: 38, lineHeight: 44 },
} as const;

/** Android takes tile 12 and sheet 28 (§1). */
export const radius = { tile: 11, card: 12, sheet: 22, pill: 999 } as const;

/**
 * The two border widths this design has, and there is no third.
 *
 * `hairline` is the 1px rule §1 gives `color.hairline` — a tile edge, a card, a field.
 * `selected` is the 1.5px inset that means **this one is chosen**: §4.3's clay inset on
 * your vote, §4.2's moss inset on the card you picked, §3's clay inset on the shared
 * Centre, and the ring around a Managed Member's dot.
 *
 * Named because 1.5 was written out at six sites and a seventh would have been a 2 without
 * anything noticing. And because the number is the *meaning*: §4.2 says the border width
 * does not change with selection — only its colour does — so both states are `selected`
 * and a card that grew a thicker edge when chosen would shift its own text.
 */
export const stroke = { hairline: 1, selected: 1.5 } as const;

/**
 * Four bespoke animations (§5); screen transitions stay platform default and unstyled.
 * Under Reduce Motion all four collapse to `reduced` — but haptics stay, because they
 * carry the reward and they are not motion.
 */
export const motion = {
  tap: { duration: 120, easing: 'ease-out' },
  grow: { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' },
  complete: { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
  lineStep: { duration: 60, easing: 'linear' },
  reduced: { duration: 150, easing: 'linear' },
} as const;

/** The board never scrolls, never shrinks, never paginates (§3, `<Board>`). */
export const board = {
  // No `columns` here. Five is not a design token — it is the Board's geometry, and
  // `BOARD_WIDTH` in src/domain/lines.ts is the same five that `position = row * 5 + col`
  // and the twelve Lines are built from (§5.4). A second copy is a copy that can disagree
  // with line detection.
  gap: { ios: 7, android: 8 },
  paddingHorizontal: { ios: 20, android: 16 },
} as const;
