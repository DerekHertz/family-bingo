import { describe, expect, it } from 'vitest';
import {
  AUTHORABLE_SQUARES,
  CENTRE_POSITION,
  boardIsComplete,
  emptySquares,
  readiness,
  readinessCopy,
} from './ready';

/** 25 Tiles, with `filled` positions carrying a Goal and the rest empty. */
const board = (filled: readonly number[]) =>
  Array.from({ length: 25 }, (_, position) => ({
    position,
    goal: filled.includes(position) ? { text: 'Walk every day' } : null,
  }));

const allAuthorable = Array.from({ length: 25 }, (_, p) => p).filter(
  (p) => p !== CENTRE_POSITION,
);

describe('boardIsComplete (§22.2)', () => {
  it('is true when all 24 authorable squares hold a Goal', () => {
    expect(boardIsComplete(board(allAuthorable))).toBe(true);
  });

  it('ignores the Centre, which is never the Member’s to fill (§6.5, §9.5)', () => {
    // Every authorable square filled, Tile 12 empty — which is what every Board looks
    // like during the Setup Window. Requiring it would make Ready unreachable.
    const tiles = board(allAuthorable);
    expect(tiles.find((t) => t.position === CENTRE_POSITION)?.goal).toBeNull();
    expect(boardIsComplete(tiles)).toBe(true);
  });

  it('is false with one square left', () => {
    expect(boardIsComplete(board(allAuthorable.slice(0, 23)))).toBe(false);
  });

  it('is false for an empty Board', () => {
    expect(boardIsComplete(board([]))).toBe(false);
  });

  /**
   * `every()` over an empty array is `true`. A failed or half-loaded Tiles query would
   * otherwise read as a finished Board and offer a control that seals four other
   * people's Boards — the same fail-open shape as `swapsUsed: budget.data ?? 0`.
   */
  it('fails shut on a Tiles list that never arrived', () => {
    expect(boardIsComplete([])).toBe(false);
  });

  it('fails shut on a short page — 23 squares present and all of them filled', () => {
    const short = board(allAuthorable).filter((t) => t.position < 23);
    expect(short.every((t) => t.position === CENTRE_POSITION || t.goal !== null)).toBe(true);
    expect(boardIsComplete(short)).toBe(false);
  });

  it('knows how many squares a Member writes', () => {
    expect(AUTHORABLE_SQUARES).toBe(24);
  });
});

describe('emptySquares', () => {
  it('lists what is left, in position order', () => {
    expect(emptySquares(board([0, 1, 2]))).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it('never includes the Centre', () => {
    expect(emptySquares(board(allAuthorable))).toEqual([]);
  });
});

describe('readiness (§22.3)', () => {
  const b = (displayName: string, readyAt: string | null, sealedAt: string | null = null) => ({
    displayName,
    readyAt,
    sealedAt,
  });

  it('counts who has said they are done', () => {
    const state = readiness([
      b('Alice', '2026-12-20T10:00:00Z'),
      b('Bob', null),
      b('Theo', '2026-12-20T11:00:00Z'),
    ]);
    expect(state).toEqual({
      total: 3,
      ready: 2,
      waitingOn: ['Bob'],
      unanimous: false,
    });
  });

  it('is unanimous when nobody is left', () => {
    const state = readiness([b('Alice', '2026-12-20T10:00:00Z'), b('Bob', '2026-12-20T11:00:00Z')]);
    expect(state.unanimous).toBe(true);
    expect(state.waitingOn).toEqual([]);
  });

  /**
   * A late joiner sealed on their own clock (§21.1) is not someone the Family is waiting
   * for — they have been playing for a month. Counting them would leave an active Year
   * permanently reading "waiting on Nia".
   */
  it('ignores a Board that has already sealed', () => {
    const state = readiness([
      b('Alice', null),
      b('Nia', null, '2026-07-04T12:00:00Z'),
    ]);
    expect(state.total).toBe(1);
    expect(state.waitingOn).toEqual(['Alice']);
  });

  it('is not unanimous with no Boards at all', () => {
    // The vacuous reading of "no Board is unready" would seal a Year the instant it opened.
    expect(readiness([]).unanimous).toBe(false);
  });
});

describe('readinessCopy (§4.5 — factual, never conditional)', () => {
  const state = (ready: number, waitingOn: string[]) => ({
    total: ready + waitingOn.length,
    ready,
    waitingOn,
    unanimous: waitingOn.length === 0 && ready > 0,
  });

  it('names the one person still writing', () => {
    expect(readinessCopy(state(3, ['Bob']))).toBe('waiting on Bob');
  });

  it('counts rather than listing once there is more than one', () => {
    expect(readinessCopy(state(1, ['Bob', 'Theo']))).toBe('1 of 3 boards are done');
  });

  it('says so when everyone is done', () => {
    expect(readinessCopy(state(4, []))).toBe('everyone is done');
  });

  it('says something honest about a Year with no Boards', () => {
    expect(readinessCopy(state(0, []))).toBe('no boards yet');
  });
});
