/**
 * The sunflower's geometry, as numbers (FRONTEND_DESIGN §2).
 *
 * Pure and separate from the component so it can be unit-tested without a renderer —
 * every other piece of load-bearing logic in this repo is (PRD §9.4), and this one is
 * load-bearing: the petal spread is the whole completion animation.
 *
 * > The petals widen from budding to complete — 26° → 32° — so the flower reads as
 * > *opening* rather than simply changing colour. That is the whole animation.
 *
 * No SVG and no asset (§7.5): the board renders 25 of these on every launch, and views
 * with border-radius are cheaper and themeable. Eight rounded rectangles and a circle.
 */

/** Petal spread in degrees, of every 45° sector. §2's table fixes both values. */
export const PETAL_SPREAD = { budding: 26, complete: 32 } as const;

/** Head size in points. 18pt at the stem tip, 27pt centred once the Tile completes. */
export const HEAD_SIZE = { budding: 18, complete: 27 } as const;

export interface Petal {
  /** Radial length, from the disc outward. Fixed — the spread does not change it. */
  readonly width: number;
  /** Angular extent, perpendicular to the radius. This is what the spread scales. */
  readonly height: number;
  readonly borderRadius: number;
  /** Degrees clockwise from vertical; eight petals at a 45° period. */
  readonly rotation: number;
  /** Distance from centre, along the petal's own rotation. */
  readonly offset: number;
}

/**
 * The eight petals of a head of a given size.
 *
 * Proportions come from §2: each petal is 0.42 long × 0.20 wide with a 0.10 radius, pushed
 * 0.29 out from centre — those are the `complete` values. `spread` is the angular width in
 * degrees, 26° at budding and 32° at complete, and it scales the petal's ANGULAR extent so
 * the flower reads as opening.
 */
export const petalsOf = (size: number, spread: number): Petal[] =>
  Array.from({ length: 8 }, (_, i) => ({
    // `width` is the petal's RADIAL length — after `rotate(i*45deg) translateX(offset)` the
    // petal's x-axis points outward from the centre, so its length is fixed and it is
    // `height` that spans the angle. Scaling width instead made the flower LENGTHEN as it
    // opened rather than widen, which is the opposite of what §2 asks for.
    width: size * 0.42,
    height: size * 0.2 * (spread / PETAL_SPREAD.complete),
    borderRadius: size * 0.1,
    rotation: i * 45,
    offset: size * 0.29,
  }));

/** The disc: a child at inset 29%, which is `clayDeep` in both states. */
export const discOf = (size: number) => ({
  size: size * 0.42,
  inset: size * 0.29,
});

/**
 * Stem, leaf and their contact point (§2).
 *
 * > The leaf is positioned against the stem, never against the tile. This is the one
 * > geometry rule in the system that is easy to get wrong and obvious when it is.
 *
 * Centring the leaf inside the stem's own span is what guarantees it touches at every
 * progress value AND that its top clears the flower head at 82%, where the head's bottom
 * sits at `12 + progress * 20`. A leaf given its own `bottom` curve outruns the stem and
 * ends up floating.
 */

/**
 * Below this, §2's table draws a seed and no stem — so no leaf exists to position.
 *
 * It is a real boundary, not a formality. `leafSize` has a 9pt floor while the stem starts
 * at 7pt, so for progress under ~0.10 the centring arithmetic puts the leaf's base beneath
 * the stem's and it floats. Callers must not ask for stem geometry below `sprouting`;
 * `stageOf()` in src/domain/growth.ts is what keeps them honest.
 */
export const LEAF_APPEARS_AT = 0.18;

export interface Stem {
  readonly stemHeight: number;
  readonly leafSize: number;
  readonly leafBottom: number;
  readonly headBottom: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const stemOf = (progress: number): Stem => {
  const p = clamp(progress, 0, 1);
  const stemHeight = 7 + p * 20;
  const leafSize = clamp(Math.round(stemHeight - 1), 9, 12);
  return {
    stemHeight,
    leafSize,
    // The stem sits 9pt above the tile floor; the leaf is centred within its span.
    leafBottom: 9 + (stemHeight - leafSize) / 2,
    headBottom: 12 + p * 20,
  };
};
