/**
 * The Board's geometry: 25 Tiles, 12 Lines, and the pure function that turns a set of
 * completed positions into the Lines they close.
 *
 * Positions are row-major, 0-indexed (PRD §5.4): position `p` is row `p / 5`,
 * column `p % 5`. This is load-bearing for line detection — do not change it.
 *
 *   0  1  2  3  4
 *   5  6  7  8  9
 *  10 11 12 13 14      <- 12 is the Center Tile
 *  15 16 17 18 19
 *  20 21 22 23 24
 *
 * Everything here is pure and has no imports (PRD §13.6).
 */

export const BOARD_WIDTH = 5;
export const BOARD_SIZE = 25;
export const CENTER_POSITION = 12;

/** Every position on a Board, in order. */
export const BOARD_POSITIONS: readonly number[] = Array.from(
  { length: BOARD_SIZE },
  (_, p) => p,
);

/**
 * The twelve Lines, enumerated as constants rather than computed (PRD §13.1).
 *
 * The order is part of the contract: `milestones.line_index` refers to it, and the
 * 12-segment pip row beneath the Board renders in it.
 *
 * Indices 0–4 are rows, 5–9 are columns, 10 is the ↘ diagonal, 11 is the ↙ diagonal.
 */
export const LINES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
] as const;

/** Row of a position, 0–4 (§5.4). */
export const rowOf = (position: number): number => Math.floor(position / BOARD_WIDTH);

/** Column of a position, 0–4 (§5.4). */
export const columnOf = (position: number): number => position % BOARD_WIDTH;

/**
 * Anything carrying a `position`, grouped into the Board's five rows and sorted by column.
 *
 * The renderer needs rows because a 5×5 laid out as one wrapping strip cannot be made
 * exact: five children of `100/5`% plus four gaps is wider than the row that holds them,
 * so the fifth wraps and the board silently becomes 4×7. Five explicit rows of five
 * `flex: 1` children need no percentage at all and land on §3's 66.8pt at 402pt.
 *
 * Rows are always `BOARD_WIDTH` long, and a position nobody supplied is a `null` hole
 * rather than a shortened row — a Board missing a Tile must still be square, or every
 * square after the gap shifts into the wrong column and the pip row beneath it describes
 * lines that are not there.
 */
export const rowsOf = <T extends { position: number }>(
  items: readonly T[],
): (T | null)[][] => {
  const byPosition = new Map(items.map((item) => [item.position, item]));
  return Array.from({ length: BOARD_WIDTH }, (_, row) =>
    Array.from(
      { length: BOARD_WIDTH },
      (_, column) => byPosition.get(row * BOARD_WIDTH + column) ?? null,
    ),
  );
};

/**
 * Line indices passing through a position. The Center Tile sits on 4 of them, which is
 * why completing a shared Family Goal advances every Member on four Lines at once.
 */
export const linesThrough = (position: number): number[] =>
  LINES.flatMap((line, index) => (line.includes(position) ? [index] : []));

/**
 * Lines fully closed by a set of completed Tile positions, in constant order.
 *
 * Pure: derived on every read from `COUNT(increments) >= target`, never stored
 * (schema.md §3.1).
 */
export const completedLines = (done: ReadonlySet<number>): number[] =>
  LINES.flatMap((line, index) => (line.every((p) => done.has(p)) ? [index] : []));

/** All 25 Tiles complete (PRD §13.3). */
export const isBlackout = (done: ReadonlySet<number>): boolean =>
  BOARD_POSITIONS.every((p) => done.has(p));
