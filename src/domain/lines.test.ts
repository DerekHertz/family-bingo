import { describe, expect, it } from 'vitest';
import {
  BOARD_POSITIONS,
  CENTER_POSITION,
  LINES,
  columnOf,
  completedLines,
  isBlackout,
  lineName,
  linesThrough,
  rowOf,
  rowsOf,
} from './lines';

/**
 * Reference implementation, written independently of the one under test, so the
 * randomised cross-check below is not just comparing a function to itself.
 */
const bruteForce = (done: ReadonlySet<number>): number[] => {
  const out: number[] = [];
  for (let i = 0; i < LINES.length; i++) {
    let all = true;
    for (const p of LINES[i]!) if (!done.has(p)) all = false;
    if (all) out.push(i);
  }
  return out;
};

const allPositions = () => new Set(BOARD_POSITIONS);

describe('the twelve Lines', () => {
  it('has exactly 12 Lines — 5 rows, 5 columns, 2 diagonals (§13.1)', () => {
    expect(LINES).toHaveLength(12);
  });

  it('gives every Line exactly 5 positions', () => {
    for (const line of LINES) expect(line).toHaveLength(5);
  });

  it('keeps every position within 0..24', () => {
    for (const line of LINES) {
      for (const p of line) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(24);
      }
    }
  });

  it('enumerates the Lines in the exact constant order of schema.md §5', () => {
    // The order is load-bearing: the 12-segment pip row under the Board renders in
    // this order, and milestones.line_index refers to it.
    expect(LINES.map((l) => [...l])).toEqual([
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
    ]);
  });

  it('covers all 25 positions', () => {
    const covered = new Set(LINES.flatMap((l) => [...l]));
    expect(covered.size).toBe(25);
  });

  it('puts the Center Tile on exactly 4 Lines — row 2, column 2, both diagonals', () => {
    expect(CENTER_POSITION).toBe(12);
    expect(linesThrough(CENTER_POSITION)).toEqual([2, 7, 10, 11]);
  });

  it('puts each corner on 3 Lines and each edge-centre on 2', () => {
    expect(linesThrough(0)).toHaveLength(3); // row 0, column 0, diagonal
    expect(linesThrough(4)).toHaveLength(3);
    expect(linesThrough(20)).toHaveLength(3);
    expect(linesThrough(24)).toHaveLength(3);
    expect(linesThrough(1)).toHaveLength(2); // row 0, column 1
    expect(linesThrough(7)).toHaveLength(2); // row 1, column 2
  });
});

describe('row-major indexing (§5.4)', () => {
  it('reads position p as row p/5, column p%5', () => {
    expect(rowOf(0)).toBe(0);
    expect(columnOf(0)).toBe(0);
    expect(rowOf(12)).toBe(2);
    expect(columnOf(12)).toBe(2);
    expect(rowOf(24)).toBe(4);
    expect(columnOf(24)).toBe(4);
    expect(rowOf(7)).toBe(1);
    expect(columnOf(7)).toBe(2);
  });

  it('agrees with the enumerated rows and columns', () => {
    for (let r = 0; r < 5; r++) {
      for (const p of LINES[r]!) expect(rowOf(p)).toBe(r);
    }
    for (let c = 0; c < 5; c++) {
      for (const p of LINES[5 + c]!) expect(columnOf(p)).toBe(c);
    }
  });
});

describe('completedLines', () => {
  it('returns nothing for an empty Board', () => {
    expect(completedLines(new Set())).toEqual([]);
  });

  it('returns all 12 for a Blackout', () => {
    expect(completedLines(allPositions())).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it.each(LINES.map((line, i) => [i, line] as const))(
    'completing exactly Line %i completes that Line and no other',
    (index, line) => {
      expect(completedLines(new Set(line))).toEqual([index]);
    },
  );

  it.each(
    LINES.flatMap((line, i) => line.map((missing) => [i, missing] as const)),
  )('does not complete Line %i when position %i is missing', (index, missing) => {
    const done = new Set(LINES[index]!.filter((p) => p !== missing));
    expect(completedLines(done)).not.toContain(index);
  });

  it('reports several Lines at once, in constant order', () => {
    // Row 0 and column 0 share position 0.
    const done = new Set([0, 1, 2, 3, 4, 5, 10, 15, 20]);
    expect(completedLines(done)).toEqual([0, 5]);
  });

  it('reports the 4 Lines the Center Tile sits on when its two diagonals, row and column fill', () => {
    const done = new Set([
      ...LINES[2]!,
      ...LINES[7]!,
      ...LINES[10]!,
      ...LINES[11]!,
    ]);
    expect(completedLines(done)).toEqual([2, 7, 10, 11]);
  });

  it('ignores positions outside the Board', () => {
    expect(completedLines(new Set([...LINES[0]!, 99, -1]))).toEqual([0]);
  });

  it('agrees with a brute-force reference across 2000 random Boards', () => {
    let seed = 20270101;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 2000; n++) {
      const done = new Set<number>();
      for (const p of BOARD_POSITIONS) if (next() < 0.6) done.add(p);
      expect(completedLines(done)).toEqual(bruteForce(done));
    }
  });

  it('is pure — it does not mutate the set it is given', () => {
    const done = new Set([0, 1, 2, 3, 4]);
    completedLines(done);
    expect([...done]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('isBlackout', () => {
  it('is true only when all 25 Tiles are complete (§13.3)', () => {
    expect(isBlackout(allPositions())).toBe(true);
  });

  it.each(BOARD_POSITIONS)('is false when position %i is still open', (missing) => {
    const done = allPositions();
    done.delete(missing);
    expect(isBlackout(done)).toBe(false);
  });

  it('is false for an empty Board', () => {
    expect(isBlackout(new Set())).toBe(false);
  });

  it('is not fooled by out-of-range positions padding the count', () => {
    const done = new Set([...BOARD_POSITIONS.filter((p) => p !== 24), 99, 100]);
    expect(isBlackout(done)).toBe(false);
  });
});

describe('rowsOf — the Board laid out as five rows (§5.4)', () => {
  const tiles = BOARD_POSITIONS.map((position) => ({ position, id: `t${position}` }));

  it('is always 5 rows of 5, even from an empty list', () => {
    for (const input of [tiles, tiles.slice(0, 3), []]) {
      const rows = rowsOf(input);
      expect(rows).toHaveLength(5);
      for (const row of rows) expect(row).toHaveLength(5);
    }
  });

  it('puts every position in the row and column §5.4 gives it', () => {
    const rows = rowsOf(tiles);
    for (const p of BOARD_POSITIONS) {
      expect(rows[rowOf(p)]![columnOf(p)]).toEqual({ position: p, id: `t${p}` });
    }
  });

  it('reads the same whatever order the Tiles arrived in', () => {
    const shuffled = [...tiles].reverse();
    expect(rowsOf(shuffled)).toEqual(rowsOf(tiles));
  });

  it('puts the Center Tile in the middle of the middle row', () => {
    expect(rowsOf(tiles)[2]![2]!.position).toBe(CENTER_POSITION);
  });

  // The reason rows exist rather than one wrapping strip: a missing Tile must leave a hole
  // in its own place, not pull every later square one column to the left. A shifted board
  // would render lines that are not there.
  it('leaves a null hole where a Tile is missing, without shifting the rest', () => {
    const rows = rowsOf(tiles.filter((t) => t.position !== 7));
    expect(rows[1]![2]).toBeNull();
    expect(rows[1]![3]!.position).toBe(8);
    expect(rows[4]![4]!.position).toBe(24);
  });

  it('ignores positions that are not on a Board', () => {
    const rows = rowsOf([...tiles, { position: 25, id: 'off' }, { position: -1, id: 'off' }]);
    expect(rows.flat().map((t) => t!.id)).toEqual(tiles.map((t) => t.id));
  });
});

describe('lineName (§6 A5)', () => {
  // A5's own example: "Bingo. Row 2 complete."
  it('names the five rows from one, not from zero', () => {
    expect(lineName(0)).toBe('Row 1');
    expect(lineName(4)).toBe('Row 5');
  });

  it('names the five columns from one', () => {
    expect(lineName(5)).toBe('Column 1');
    expect(lineName(9)).toBe('Column 5');
  });

  // Named by the corner they start from. "Left to right" describes both of them to anyone
  // reading across, and a Member who cannot see the board has no other way to tell which
  // one closed.
  it('names each diagonal by the corner it starts from', () => {
    expect(lineName(10)).toBe('The top-left diagonal');
    expect(lineName(11)).toBe('The top-right diagonal');
  });

  it('names every one of the twelve, and each of them differently', () => {
    const names = LINES.map((_, i) => lineName(i));
    expect(new Set(names).size).toBe(LINES.length);
  });

  // The index comes from `milestones.line_index`, which the database constrains to 0–11.
  // Inventing a name for anything else would hide a bug upstream rather than surface it.
  it('refuses an index that is not one of the twelve', () => {
    expect(() => lineName(12)).toThrow(RangeError);
    expect(() => lineName(-1)).toThrow(RangeError);
  });
});
