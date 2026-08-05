import { describe, expect, it } from 'vitest';
import { newlyCelebrated } from './celebration';

describe('newlyCelebrated (§12.2, §5)', () => {
  it('celebrates nothing when nothing has changed', () => {
    expect(newlyCelebrated(new Set(['a', 'b']), new Set(['a', 'b']))).toEqual([]);
  });

  it('celebrates a Milestone that has just appeared', () => {
    expect(newlyCelebrated(new Set(['a', 'b']), new Set(['a']))).toEqual(['b']);
  });

  // The whole point: opening a Board finished last week must not replay five
  // celebrations. The first read seeds `seen` with everything and celebrates none of it.
  it('celebrates nothing on a first read that already has Milestones', () => {
    const alreadyThere = new Set(['a', 'b', 'c']);
    expect(newlyCelebrated(alreadyThere, alreadyThere)).toEqual([]);
  });

  it('never re-celebrates once seen, however many times it is asked', () => {
    const seen = new Set(['a']);
    for (let i = 0; i < 5; i += 1) {
      expect(newlyCelebrated(new Set(['a']), seen)).toEqual([]);
    }
  });

  it('celebrates several at once in a stable order', () => {
    expect(newlyCelebrated(new Set(['c', 'a', 'b']), new Set())).toEqual(['a', 'b', 'c']);
  });

  it('is not confused by a Milestone disappearing — a deleted Increment is not a demotion', () => {
    // §11.3 permits deleting an Increment, but the Milestone was pushed and cannot be
    // unsent (§15.3). Nothing here should treat its absence as something to celebrate.
    expect(newlyCelebrated(new Set(), new Set(['a']))).toEqual([]);
  });

  it('does not mutate either set', () => {
    const current = new Set(['a', 'b']);
    const seen = new Set(['a']);
    newlyCelebrated(current, seen);
    expect([...current]).toEqual(['a', 'b']);
    expect([...seen]).toEqual(['a']);
  });
});
