/**
 * The progress ring's geometry, as numbers (FRONTEND_DESIGN §3 `<TileSheet>`).
 *
 * > **Ring** — 92pt conic ring, `moss` on `paperSunk`, `count` at 23pt/700 and
 * > `of {target}` at 11pt inside. This is the one place the exact number appears large.
 *
 * React Native has no `conic-gradient` — the same constraint that made the sunflower eight
 * `View`s — so the sweep is built from **two half-disc wedges**, each pinned at the ring's
 * centre and rotated. The right wedge covers the first half turn, the left the second, and
 * a disc in the sheet's own colour punches the hole through the middle.
 *
 * Pure and separate from the component so it can be unit-tested without a renderer, like
 * `sunflower.ts`. Nothing here knows about React.
 */

/** §3's ring: 92pt across, and thick enough to read a sweep at a glance. */
export const RING_SIZE = 92;
export const RING_THICKNESS = 8;

export interface RingSweep {
  /**
   * Degrees to rotate the right-hand wedge, 0–180. Reaches 180 at half a turn and stays
   * there — past halfway the right side is fully covered and the left takes over.
   */
  readonly rightRotation: number;
  /** Degrees to rotate the left-hand wedge, 0–180. Zero until past halfway. */
  readonly leftRotation: number;
  /**
   * Whether the left wedge should be drawn at all.
   *
   * It cannot simply sit at rotation 0 and be harmless: an unrotated wedge covers its
   * whole half, so a ring at 10% would read as 50%. Below halfway the left wedge is not
   * rendered.
   */
  readonly pastHalf: boolean;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Where each wedge sits for a given progress.
 *
 * `progress` is clamped: the ring stops at full. 160 of 150 draws a closed ring, because
 * a sweep that wrapped past the top would read as *less* done than it is — and the exact
 * number is stated beside it anyway (`countSummary`).
 */
export const sweepOf = (progress: number): RingSweep => {
  const p = clamp01(progress);
  return {
    rightRotation: Math.min(p, 0.5) * 360,
    leftRotation: Math.max(0, p - 0.5) * 360,
    pastHalf: p > 0.5,
  };
};

export interface RingBox {
  readonly size: number;
  readonly radius: number;
  /** The half-disc wedge: half the width, full height, rounded on its outer edge. */
  readonly wedgeWidth: number;
  /** The hole punched through the middle, in the sheet's own ground colour. */
  readonly holeSize: number;
  readonly holeRadius: number;
}

export const ringBox = (size = RING_SIZE, thickness = RING_THICKNESS): RingBox => ({
  size,
  radius: size / 2,
  wedgeWidth: size / 2,
  holeSize: size - thickness * 2,
  holeRadius: (size - thickness * 2) / 2,
});
