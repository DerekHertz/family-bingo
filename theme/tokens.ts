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
  label: { fontFamily: font.ui, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  meta: {
    fontFamily: font.ui,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
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
  minTouch: 44,
  stack: 10,
  formWidth: 340,
  proseWidth: 300,
  wordmark: { fontSize: 38, lineHeight: 44 },
} as const;

/** Android takes tile 12 and sheet 28 (§1). */
export const radius = { tile: 11, card: 12, sheet: 22, pill: 999 } as const;

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
  columns: 5,
  gap: { ios: 7, android: 8 },
  paddingHorizontal: { ios: 20, android: 16 },
} as const;
