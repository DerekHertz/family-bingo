import { describe, expect, it } from 'vitest';
import { LINES } from './lines';
import {
  type BoardTile,
  type RecordedMilestones,
  completedPositions,
  milestonesToEmit,
  nothingRecorded,
} from './milestones';

/** A Board where the given positions are complete and the rest are dormant. */
const boardWith = (done: readonly number[], target = 3): BoardTile[] =>
  Array.from({ length: 25 }, (_, position) => ({
    position,
    count: done.includes(position) ? target : 0,
    target,
  }));

const recorded = (over: Partial<RecordedMilestones> = {}): RecordedMilestones => ({
  ...nothingRecorded(),
  ...over,
});

describe('completedPositions', () => {
  it('counts a Tile complete when Increments reach the Target', () => {
    const tiles: BoardTile[] = [
      { position: 0, count: 3, target: 3 },
      { position: 1, count: 2, target: 3 },
      { position: 2, count: 9, target: 3 },
    ];
    expect([...completedPositions(tiles)]).toEqual([0, 2]);
  });

  it('never completes an unfilled Tile on a sealed Board (§10.2)', () => {
    // An unfinished Board seals with empty Tiles; they are filled with Swaps later.
    const tiles: BoardTile[] = [{ position: 0, count: 0, target: null }];
    expect([...completedPositions(tiles)]).toEqual([]);
  });

  it('completes a one-shot Goal on its single Increment', () => {
    expect([...completedPositions([{ position: 7, count: 1, target: 1 }])]).toEqual([7]);
  });
});

describe('milestonesToEmit — Tiles (§12.2)', () => {
  it('emits one tile_completed when a Tile crosses its Target', () => {
    const tiles: BoardTile[] = [{ position: 4, count: 3, target: 3 }];
    expect(milestonesToEmit(tiles, recorded())).toEqual([
      { type: 'tile_completed', position: 4 },
    ]);
  });

  it('emits nothing further as Increments pile up past the Target', () => {
    const tiles: BoardTile[] = [{ position: 4, count: 99, target: 3 }];
    const already = recorded({ tilePositions: new Set([4]) });
    expect(milestonesToEmit(tiles, already)).toEqual([]);
  });

  it('emits nothing for a Tile still short of its Target', () => {
    const tiles: BoardTile[] = [{ position: 4, count: 2, target: 3 }];
    expect(milestonesToEmit(tiles, recorded())).toEqual([]);
  });

  it('is idempotent — replaying the same state emits nothing the second time', () => {
    // This is what keeps an offline replay from re-firing the completion animation
    // (FRONTEND_DESIGN §5): gate on the Milestone insert, not on count >= target.
    const tiles = boardWith([0, 1, 2]);
    const first = milestonesToEmit(tiles, recorded());
    expect(first).toHaveLength(3);

    const after = recorded({ tilePositions: new Set([0, 1, 2]) });
    expect(milestonesToEmit(tiles, after)).toEqual([]);
  });
});

describe('milestonesToEmit — Lines, Bingo, Blackout (§13)', () => {
  it('emits bingo for the very first Line, alongside the Tile that closed it', () => {
    const tiles = boardWith([0, 1, 2, 3, 4]);
    const already = recorded({ tilePositions: new Set([0, 1, 2, 3]) });
    expect(milestonesToEmit(tiles, already)).toEqual([
      { type: 'tile_completed', position: 4 },
      { type: 'bingo', lineIndex: 0 },
    ]);
  });

  it('emits the quieter line_completed for every Line after the first (§13.2)', () => {
    const tiles = boardWith([...LINES[0]!, ...LINES[1]!]);
    const already = recorded({
      tilePositions: new Set(LINES[0]),
      lineIndexes: new Set([0]),
    });
    const emitted = milestonesToEmit(tiles, already);
    expect(emitted.filter((m) => m.type === 'bingo')).toEqual([]);
    expect(emitted.filter((m) => m.type === 'line_completed')).toEqual([
      { type: 'line_completed', lineIndex: 1 },
    ]);
  });

  it('emits exactly one bingo when several Lines close at the same moment', () => {
    // Position 0 closes row 0, column 0 and the ↘ diagonal together.
    const tiles = boardWith([...LINES[0]!, ...LINES[5]!, ...LINES[10]!]);
    const emitted = milestonesToEmit(tiles, recorded());
    const lines = emitted.filter(
      (m) => m.type === 'bingo' || m.type === 'line_completed',
    );
    expect(lines).toEqual([
      { type: 'bingo', lineIndex: 0 },
      { type: 'line_completed', lineIndex: 5 },
      { type: 'line_completed', lineIndex: 10 },
    ]);
  });

  it('never emits a second bingo, however many Lines follow', () => {
    let already = recorded();
    let done: number[] = [];
    let bingos = 0;
    for (const line of LINES) {
      done = [...new Set([...done, ...line])];
      const emitted = milestonesToEmit(boardWith(done), already);
      bingos += emitted.filter((m) => m.type === 'bingo').length;
      already = recorded({
        tilePositions: new Set(done),
        lineIndexes: new Set([
          ...already.lineIndexes,
          ...emitted.flatMap((m) => (m.lineIndex === undefined ? [] : [m.lineIndex])),
        ]),
        blackout: already.blackout || emitted.some((m) => m.type === 'blackout'),
      });
    }
    expect(bingos).toBe(1);
  });

  it('emits blackout when all 25 Tiles are complete (§13.3)', () => {
    const tiles = boardWith([...Array(25).keys()]);
    const emitted = milestonesToEmit(tiles, recorded({
      tilePositions: new Set([...Array(25).keys()]),
      lineIndexes: new Set([...Array(12).keys()]),
    }));
    expect(emitted).toEqual([{ type: 'blackout' }]);
  });

  it('emits blackout only once', () => {
    const tiles = boardWith([...Array(25).keys()]);
    const already = recorded({
      tilePositions: new Set([...Array(25).keys()]),
      lineIndexes: new Set([...Array(12).keys()]),
      blackout: true,
    });
    expect(milestonesToEmit(tiles, already)).toEqual([]);
  });

  it('orders emissions Tiles, then Lines in constant order, then Blackout', () => {
    const tiles = boardWith([...Array(25).keys()]);
    const emitted = milestonesToEmit(tiles, recorded());
    expect(emitted.slice(0, 25).every((m) => m.type === 'tile_completed')).toBe(true);
    expect(emitted[25]).toEqual({ type: 'bingo', lineIndex: 0 });
    expect(emitted.slice(26, 37).every((m) => m.type === 'line_completed')).toBe(true);
    expect(emitted.at(-1)).toEqual({ type: 'blackout' });
    expect(emitted).toHaveLength(38); // 25 tiles + 12 lines + 1 blackout
  });

  it('keeps playing after Bingo — a full Board still emits every later Line (§13.4)', () => {
    const tiles = boardWith([...Array(25).keys()]);
    const emitted = milestonesToEmit(tiles, recorded({ lineIndexes: new Set([0]) }));
    const lineIndexes = emitted.flatMap((m) => (m.lineIndex === undefined ? [] : [m.lineIndex]));
    expect(lineIndexes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('does not mutate what it is given', () => {
    const tiles = boardWith([0, 1, 2, 3, 4]);
    const already = recorded();
    milestonesToEmit(tiles, already);
    expect(already.tilePositions.size).toBe(0);
    expect(already.lineIndexes.size).toBe(0);
    expect(tiles[0]!.count).toBe(3);
  });
});
