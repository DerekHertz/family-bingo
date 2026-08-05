/**
 * Where the hairline through a completed Line is drawn (FRONTEND_DESIGN §5, "Line").
 *
 * > **Line** — 5 × 60ms. The five tiles pulse in sequence along the line's direction
 * > (diagonals corner to corner), then a 1px `clay` hairline draws through them.
 *
 * Pure geometry, no React — the same split as `sunflower.ts`, and for the same reason: a
 * rotated segment across a 5×5 is arithmetic that is easy to get subtly wrong and trivial
 * to test once it is a function. The renderer only positions a `<View>`.
 *
 * The board's own measurements are the input rather than a constant, because the grid is
 * `flex: 1` inside whatever width the handset gives it (§3 puts it at 66.8pt on a 402pt
 * screen and 61.4pt on the 375pt floor). Measuring is the only honest way to know.
 */

import { BOARD_WIDTH, LINES, columnOf, rowOf } from '../domain/lines';

/** The centre of one square, in the grid's own coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A segment as React Native can actually draw it: an axis-aligned `<View>` of `length` ×
 * `thickness` placed at `left`/`top`, then rotated about its own centre.
 *
 * `rotation` is in degrees because that is what the `transform` prop takes; radians would
 * be converted at every call site, which is exactly the sort of duplication this file
 * exists to prevent.
 */
export interface Segment {
  readonly left: number;
  readonly top: number;
  readonly length: number;
  readonly thickness: number;
  readonly rotation: number;
}

/**
 * The side of one square, given the grid's total width.
 *
 * Five squares and four gaps, which is the same arithmetic `<Board>`'s `flex: 1` children
 * arrive at — stated once here so the overlay and the squares beneath it cannot disagree
 * by a pixel. A width too small to hold five gaps yields 0 rather than a negative side:
 * the first layout pass can report anything, and a segment drawn from nonsense is worse
 * than one that is briefly invisible.
 */
export const cellSize = (width: number, gap: number): number =>
  Math.max(0, (width - gap * (BOARD_WIDTH - 1)) / BOARD_WIDTH);

/** The centre of position `p` (§5.4 — row `p / 5`, column `p % 5`). */
export const centreOf = (position: number, width: number, gap: number): Point => {
  const cell = cellSize(width, gap);
  return {
    x: columnOf(position) * (cell + gap) + cell / 2,
    y: rowOf(position) * (cell + gap) + cell / 2,
  };
};

/**
 * The hairline through a Line, from the centre of its first square to the centre of its
 * last — corner to corner on a diagonal, which is what §5 asks for.
 *
 * It is drawn between centres rather than edge to edge on purpose: a line that stops at
 * the squares' edges leaves four gaps in it, and one that runs the full width of the board
 * overshoots into the padding. Centre to centre is the only version that reads as a single
 * stroke through five tiles.
 */
export const lineSegment = (
  lineIndex: number,
  width: number,
  gap: number,
  thickness: number,
): Segment => {
  const positions = LINES[lineIndex];
  if (positions === undefined) throw new RangeError(`no line ${lineIndex}`);

  const start = centreOf(positions[0]!, width, gap);
  const end = centreOf(positions[positions.length - 1]!, width, gap);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  return {
    // Positioned as an unrotated horizontal bar centred on the segment's midpoint, then
    // rotated about that centre. `transform` rotates around the element's own centre, so
    // this is the one placement where the rotation does not move the endpoints.
    left: (start.x + end.x) / 2 - length / 2,
    top: (start.y + end.y) / 2 - thickness / 2,
    length,
    thickness,
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
};

/**
 * The order the five squares pulse in (§5: "along the line's direction").
 *
 * This is `LINES[i]` unchanged, and the fact that it already reads left-to-right,
 * top-to-bottom and corner-to-corner is a property of §13.1's constant order rather than a
 * coincidence — which is why this returns it rather than sorting a copy.
 */
export const pulseOrder = (lineIndex: number): readonly number[] => {
  const positions = LINES[lineIndex];
  if (positions === undefined) throw new RangeError(`no line ${lineIndex}`);
  return positions;
};
