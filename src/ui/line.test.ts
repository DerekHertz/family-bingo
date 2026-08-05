import { describe, expect, it } from 'vitest';
import { LINES } from '../domain/lines';
import { cellSize, centreOf, lineSegment, pulseOrder } from './line';

// §3's reference geometry: a 402pt screen, 20pt of padding each side, 7pt gaps — which
// §3 states lands on 66.8pt squares. Every number below is checked against that.
const WIDTH = 402 - 40;
const GAP = 7;

describe('cellSize (§3)', () => {
  it('lands on §3′s 66.8pt at the reference width', () => {
    expect(cellSize(WIDTH, GAP)).toBeCloseTo(66.8, 5);
  });

  it('lands on §3′s 61.4pt at the 375pt SE floor', () => {
    expect(cellSize(375 - 40, GAP)).toBeCloseTo(61.4, 5);
  });

  // The first layout pass can report anything. A negative side would place the overlay
  // outside the board, which is worse than it being briefly invisible.
  it('never goes negative on a width too small to hold the gaps', () => {
    expect(cellSize(0, GAP)).toBe(0);
    expect(cellSize(10, GAP)).toBe(0);
  });
});

describe('centreOf (§5.4)', () => {
  it('puts the top-left square half a cell in from both edges', () => {
    const cell = cellSize(WIDTH, GAP);
    expect(centreOf(0, WIDTH, GAP)).toEqual({ x: cell / 2, y: cell / 2 });
  });

  it('puts the bottom-right square half a cell in from the far corner', () => {
    const cell = cellSize(WIDTH, GAP);
    expect(centreOf(24, WIDTH, GAP)).toEqual({
      x: 4 * (cell + GAP) + cell / 2,
      y: 4 * (cell + GAP) + cell / 2,
    });
  });

  // Row-major, and the whole board depends on it: position 5 is row 1, column 0.
  it('reads position row-major, not column-major', () => {
    expect(centreOf(5, WIDTH, GAP).x).toBeCloseTo(centreOf(0, WIDTH, GAP).x, 10);
    expect(centreOf(5, WIDTH, GAP).y).toBeGreaterThan(centreOf(0, WIDTH, GAP).y);
    expect(centreOf(1, WIDTH, GAP).x).toBeGreaterThan(centreOf(0, WIDTH, GAP).x);
    expect(centreOf(1, WIDTH, GAP).y).toBeCloseTo(centreOf(0, WIDTH, GAP).y, 10);
  });

  it('places the Centre Tile at the middle of the board', () => {
    const centre = centreOf(12, WIDTH, GAP);
    expect(centre.x).toBeCloseTo(WIDTH / 2, 5);
    expect(centre.y).toBeCloseTo(WIDTH / 2, 5);
  });
});

describe('lineSegment (§5)', () => {
  it('draws a row flat', () => {
    const segment = lineSegment(0, WIDTH, GAP, 1);
    expect(segment.rotation).toBeCloseTo(0, 10);
    expect(segment.length).toBeCloseTo(4 * (cellSize(WIDTH, GAP) + GAP), 5);
  });

  it('draws a column upright', () => {
    const segment = lineSegment(5, WIDTH, GAP, 1);
    expect(segment.rotation).toBeCloseTo(90, 10);
  });

  // "diagonals corner to corner" (§5). A square board makes both of them 45° as *lines* —
  // but these are directed: the hairline is drawn from the segment's start, which is the
  // corner the pulses just travelled from. The ↙ diagonal starts at the top RIGHT, so it
  // points back and to the left, and 135° rather than −45° is what keeps the draw running
  // the same way the pulses did.
  it('draws the diagonals at 45 degrees, each from its own top corner', () => {
    expect(lineSegment(10, WIDTH, GAP, 1).rotation).toBeCloseTo(45, 10);
    expect(lineSegment(11, WIDTH, GAP, 1).rotation).toBeCloseTo(135, 10);
  });

  it('is longer on a diagonal than on a row, by √2', () => {
    const row = lineSegment(0, WIDTH, GAP, 1);
    const diagonal = lineSegment(10, WIDTH, GAP, 1);
    expect(diagonal.length / row.length).toBeCloseTo(Math.SQRT2, 5);
  });

  // The placement rule: an unrotated bar centred on the segment's midpoint. Rotating about
  // its own centre is then the one transform that does not move the endpoints.
  it('centres the unrotated bar on the segment′s midpoint', () => {
    const thickness = 1;
    for (let i = 0; i < LINES.length; i += 1) {
      const positions = LINES[i]!;
      const segment = lineSegment(i, WIDTH, GAP, thickness);
      const start = centreOf(positions[0]!, WIDTH, GAP);
      const end = centreOf(positions[4]!, WIDTH, GAP);
      expect(segment.left + segment.length / 2).toBeCloseTo((start.x + end.x) / 2, 8);
      expect(segment.top + segment.thickness / 2).toBeCloseTo((start.y + end.y) / 2, 8);
    }
  });

  it('runs between the centres of the squares it crosses, never edge to edge', () => {
    const cell = cellSize(WIDTH, GAP);
    // Edge to edge would be the full grid width; centre to centre is one cell shorter.
    expect(lineSegment(0, WIDTH, GAP, 1).length).toBeCloseTo(WIDTH - cell, 5);
  });

  it('has a segment for every one of the twelve Lines', () => {
    for (let i = 0; i < LINES.length; i += 1) {
      expect(Number.isFinite(lineSegment(i, WIDTH, GAP, 1).length)).toBe(true);
    }
  });

  it('refuses a line index that is not one of the twelve', () => {
    expect(() => lineSegment(12, WIDTH, GAP, 1)).toThrow(RangeError);
    expect(() => lineSegment(-1, WIDTH, GAP, 1)).toThrow(RangeError);
  });
});

describe('pulseOrder (§5)', () => {
  // "along the line's direction (diagonals corner to corner)". That §13.1's constant order
  // already reads that way is the property this depends on — so assert it rather than
  // trusting it.
  it('runs a row left to right', () => {
    expect(pulseOrder(0)).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs a column top to bottom', () => {
    expect(pulseOrder(5)).toEqual([0, 5, 10, 15, 20]);
  });

  it('runs each diagonal from its own top corner', () => {
    expect(pulseOrder(10)).toEqual([0, 6, 12, 18, 24]);
    expect(pulseOrder(11)).toEqual([4, 8, 12, 16, 20]);
  });

  it('is the constant order of §13.1 unchanged, not a sorted copy', () => {
    for (let i = 0; i < LINES.length; i += 1) {
      expect(pulseOrder(i)).toBe(LINES[i]);
    }
  });

  it('refuses a line index that is not one of the twelve', () => {
    expect(() => pulseOrder(12)).toThrow(RangeError);
  });
});
