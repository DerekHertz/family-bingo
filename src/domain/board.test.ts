import { describe, expect, it } from 'vitest';
import { completedOn, renderTiles, type SourceTile } from './board';
import { completedLines } from './lines';

const plain = (position: number, target: number): SourceTile => ({
  id: `t${position}`,
  position,
  goal: { text: `goal ${position}`, target, unit: null },
  familyGoalText: null,
  familyGoalCompletedAt: null,
});

const empty = (position: number): SourceTile => ({
  id: `t${position}`,
  position,
  goal: null,
  familyGoalText: null,
  familyGoalCompletedAt: null,
});

const sharedCentre = (completedAt: string | null): SourceTile => ({
  id: 't12',
  position: 12,
  goal: null,
  familyGoalText: 'Eat together on Sundays',
  familyGoalCompletedAt: completedAt,
});

/** A whole Board: 24 authorable squares plus whatever centre is passed. */
const board = (centre: SourceTile, target = 1): SourceTile[] =>
  Array.from({ length: 25 }, (_, p) => (p === 12 ? centre : plain(p, target)));

describe('renderTiles (§12.1, §12.3)', () => {
  it('reads a square′s count from the Increment counts, keyed by Tile id', () => {
    const [tile] = renderTiles([plain(0, 10)], { t0: 4 });
    expect(tile?.count).toBe(4);
  });

  it('counts a Tile nobody logged against as zero rather than undefined', () => {
    const [tile] = renderTiles([plain(0, 10)], {});
    expect(tile?.count).toBe(0);
  });

  it('leaves an unfilled Tile on a sealed Board without a Goal (§10.2)', () => {
    const [tile] = renderTiles([empty(3)], {});
    expect(tile?.goal).toBeNull();
    expect(tile?.isCentre).toBe(false);
  });

  // §12.3 — the shared Centre is a Goal like any other once it is decided.
  it('gives the shared Centre the Family Goal′s text and a Target of one', () => {
    const [tile] = renderTiles([sharedCentre(null)], {});
    expect(tile?.goal).toEqual({ text: 'Eat together on Sundays', target: 1, unit: null });
    expect(tile?.isCentre).toBe(true);
  });

  // The trap this module exists to close. `tile_is_loggable()` refuses Increments on the
  // shared Centre, so counting them there answers 0 forever.
  it('reads the shared Centre′s progress from completed_at, never from Increments', () => {
    const [unmarked] = renderTiles([sharedCentre(null)], { t12: 99 });
    expect(unmarked?.count).toBe(0);
    expect(unmarked?.markedComplete).toBe(false);

    const [marked] = renderTiles([sharedCentre('2026-03-01T00:00:00Z')], { t12: 0 });
    expect(marked?.count).toBe(1);
    expect(marked?.markedComplete).toBe(true);
  });

  // A personal Centre carries an ordinary Goal and must not be treated as shared: §4.3's
  // clay ground, "We did it" and the no-count rule are the *shared* Centre's alone.
  it('does not call a personal Centre shared', () => {
    const [tile] = renderTiles([plain(12, 5)], { t12: 2 });
    expect(tile?.isCentre).toBe(false);
    expect(tile?.markedComplete).toBe(false);
    expect(tile?.count).toBe(2);
  });

  it('keeps the Tiles in the order given', () => {
    expect(renderTiles([plain(2, 1), plain(0, 1)], {}).map((t) => t.position)).toEqual([2, 0]);
  });
});

describe('completedOn (§12.1, §13.1)', () => {
  it('counts a square complete at its Target and not before', () => {
    expect([...completedOn(renderTiles([plain(0, 3)], { t0: 2 }))]).toEqual([]);
    expect([...completedOn(renderTiles([plain(0, 3)], { t0: 3 }))]).toEqual([0]);
  });

  it('counts past the Target as complete, not as something else (§2)', () => {
    expect([...completedOn(renderTiles([plain(0, 3)], { t0: 30 }))]).toEqual([0]);
  });

  it('never counts an unfilled Tile, whatever its id was counted as', () => {
    expect([...completedOn(renderTiles([empty(0)], { t0: 5 }))]).toEqual([]);
  });

  // Every authorable square logged once, on a Board whose Targets are all 1.
  const everySquareLogged = Object.fromEntries(
    Array.from({ length: 25 }, (_, p) => [`t${p}`, 1]),
  );

  // The whole reason `markedComplete` exists. Without it the four Lines through the
  // Centre — and therefore Blackout (§13.3) — are unreachable for every shared-mode
  // Family, silently, because the Centre answers 0 forever.
  it('lets a marked shared Centre close the four Lines that pass through it', () => {
    const done = completedOn(
      renderTiles(board(sharedCentre('2026-03-01T00:00:00Z')), everySquareLogged),
    );
    expect(done.has(12)).toBe(true);
    expect(completedLines(done)).toHaveLength(12);
  });

  it('leaves those four Lines open while the Family Goal is unmarked', () => {
    const done = completedOn(renderTiles(board(sharedCentre(null)), everySquareLogged));
    expect(done.has(12)).toBe(false);
    // Row 2, column 2 and both diagonals run through the Centre — twelve less those four.
    expect(completedLines(done)).toHaveLength(8);
  });
});
