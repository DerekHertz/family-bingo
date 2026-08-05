import { describe, expect, it } from 'vitest';
import {
  announcementFor,
  announcementOf,
  cardMilestone,
  hapticFor,
  loudest,
  milestoneHeadline,
  newlyCelebrated,
  type CelebratedMilestone,
} from './celebration';
import { lineName } from './lines';

const tile = (id: string): CelebratedMilestone => ({
  id,
  type: 'tile_completed',
  tileId: `tile-${id}`,
  lineIndex: null,
});
const bingo = (id: string, lineIndex: number): CelebratedMilestone => ({
  id,
  type: 'bingo',
  tileId: null,
  lineIndex,
});
const line = (id: string, lineIndex: number): CelebratedMilestone => ({
  id,
  type: 'line_completed',
  tileId: null,
  lineIndex,
});
const blackout = (id: string): CelebratedMilestone => ({
  id,
  type: 'blackout',
  tileId: null,
  lineIndex: null,
});

describe('newlyCelebrated (§12.2, §5)', () => {
  it('celebrates nothing when nothing has changed', () => {
    expect(newlyCelebrated([tile('a'), tile('b')], new Set(['a', 'b']))).toEqual([]);
  });

  it('celebrates a Milestone that has just appeared', () => {
    expect(newlyCelebrated([tile('a'), tile('b')], new Set(['a']))).toEqual([tile('b')]);
  });

  // The whole point: opening a Board finished last week must not replay five
  // celebrations. The first read seeds `seen` with everything and celebrates none of it.
  it('celebrates nothing on a first read that already has Milestones', () => {
    const current = [tile('a'), tile('b'), tile('c')];
    expect(newlyCelebrated(current, new Set(current.map((m) => m.id)))).toEqual([]);
  });

  it('never re-celebrates once seen, however many times it is asked', () => {
    const seen = new Set(['a']);
    for (let i = 0; i < 5; i += 1) {
      expect(newlyCelebrated([tile('a')], seen)).toEqual([]);
    }
  });

  // The caller's order is the server's `created_at` order. An earlier version sorted on
  // `id`, which is a random uuid — so when two Lines closed together, the one drawn was
  // whichever one won a coin toss.
  it('celebrates several at once in the order it was given, not a sorted one', () => {
    expect(newlyCelebrated([tile('c'), tile('a'), tile('b')], new Set())).toEqual([
      tile('c'),
      tile('a'),
      tile('b'),
    ]);
  });

  it('is not confused by a Milestone disappearing — a deleted Increment is not a demotion', () => {
    // §11.3 permits deleting an Increment, but the Milestone was pushed and cannot be
    // unsent (§15.3). Nothing here should treat its absence as something to celebrate.
    expect(newlyCelebrated([], new Set(['a']))).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const current = [tile('a'), tile('b')];
    const seen = new Set(['a']);
    newlyCelebrated(current, seen);
    expect(current.map((m) => m.id)).toEqual(['a', 'b']);
    expect([...seen]).toEqual(['a']);
  });

  // A Line and a Blackout have no Tile, so a Tile-keyed set could never see them. Keying
  // on the Milestone's own id is what makes one function serve all four kinds.
  it('tells apart Milestones that share a Tile of null', () => {
    expect(newlyCelebrated([bingo('a', 0), blackout('b')], new Set(['a']))).toEqual([
      blackout('b'),
    ]);
  });
});

describe('loudest (§5, §13.2)', () => {
  it('is null when nothing arrived', () => {
    expect(loudest([])).toBeNull();
  });

  // The tap that closes a Line closes a Tile first. Firing both haptics reads as a
  // malfunction rather than a reward.
  it('prefers a Bingo to the Tile that closed it', () => {
    expect(loudest([tile('a'), bingo('b', 2)])).toEqual(bingo('b', 2));
  });

  it('prefers a Blackout to everything, whatever order it arrived in', () => {
    expect(loudest([blackout('z'), bingo('a', 0), tile('b')])).toEqual(blackout('z'));
    expect(loudest([tile('b'), bingo('a', 0), blackout('z')])).toEqual(blackout('z'));
  });

  // §13.2 — every Line after the first is the quieter `line_completed`.
  it('prefers a Bingo to a later Line', () => {
    expect(loudest([line('a', 3), bingo('b', 4)])).toEqual(bingo('b', 4));
  });

  it('prefers a later Line to a Tile', () => {
    expect(loudest([tile('a'), line('b', 3)])).toEqual(line('b', 3));
  });

  it('breaks a tie on the order given, which newlyCelebrated has already made stable', () => {
    expect(loudest([tile('a'), tile('b')])).toEqual(tile('a'));
  });
});

describe('hapticFor (§5)', () => {
  // "five `light` impacts 60ms apart on Bingo" — and a Blackout is not quieter than the
  // Bingo inside it.
  it('gives Bingo and Blackout the five-impact pattern', () => {
    expect(hapticFor('bingo')).toBe('bingo');
    expect(hapticFor('blackout')).toBe('bingo');
  });

  it('gives a Tile and a later Line the success notification', () => {
    expect(hapticFor('tile_completed')).toBe('success');
    expect(hapticFor('line_completed')).toBe('success');
  });
});

describe('announcementFor (§6 A5)', () => {
  // "A completed Line announces once, on the tile that closed it — 'Bingo. Row 2
  // complete.' — not five times."
  it('says exactly what A5 asks for', () => {
    expect(announcementFor(bingo('a', 1), lineName)).toBe('Bingo. Row 2 complete.');
  });

  it('says nothing extra for a Tile — the square′s own label already flipped', () => {
    expect(announcementFor(tile('a'), lineName)).toBeNull();
  });

  it('names a later Line without calling it a Bingo', () => {
    expect(announcementFor(line('a', 7), lineName)).toBe('Column 3 complete.');
  });

  it('names a diagonal by the corner it starts from', () => {
    expect(announcementFor(line('a', 10), lineName)).toBe('The top-left diagonal complete.');
    expect(announcementFor(line('a', 11), lineName)).toBe('The top-right diagonal complete.');
  });

  // §13.4: play continues to the end of the Year, so this is a fact and not a victory.
  it('states a Blackout without declaring a win', () => {
    const said = announcementFor(blackout('a'), lineName) ?? '';
    expect(said).toBe('Blackout. All twenty-five.');
    expect(said.toLowerCase()).not.toContain('won');
  });

  // A Line Milestone always carries an index server-side, but a client that assumed so
  // would render "Bingo. undefined complete." if one ever did not.
  it('survives a Line Milestone with no index', () => {
    expect(announcementFor({ ...bingo('a', 0), lineIndex: null }, lineName)).toBe('Bingo.');
  });
});

describe('announcementOf (§5, §6 A5)', () => {
  it('says nothing when nothing arrived', () => {
    expect(announcementOf([], lineName)).toBeNull();
  });

  it('says nothing for a Tile alone — the square′s label already changed', () => {
    expect(announcementOf([tile('a')], lineName)).toBeNull();
  });

  it('says the Bingo once when a Tile closed it', () => {
    expect(announcementOf([tile('a'), bingo('b', 1)], lineName)).toBe(
      'Bingo. Row 2 complete.',
    );
  });

  // The finding this function exists for: a Blackout outranks the Bingo inside it, and a
  // Member listening rather than looking would otherwise never learn a Line had closed.
  it('names the Line that closed underneath a Blackout', () => {
    expect(announcementOf([bingo('a', 4), blackout('b')], lineName)).toBe(
      'Blackout. All twenty-five. Bingo. Row 5 complete.',
    );
  });

  it('does not say the same Line twice when it is the loudest thing that happened', () => {
    expect(announcementOf([line('a', 6)], lineName)).toBe('Column 2 complete.');
  });

  it('says the Blackout even when no Line came with it', () => {
    expect(announcementOf([blackout('a')], lineName)).toBe('Blackout. All twenty-five.');
  });
});

describe('cardMilestone (§4 Milestone card)', () => {
  const at = (m: CelebratedMilestone, createdAt: string) => ({ ...m, createdAt });

  it('is null on a Board with nothing but completed Tiles', () => {
    expect(cardMilestone([at(tile('a'), '2026-03-01T00:00:00Z')])).toBeNull();
  });

  it('is null on an empty Board', () => {
    expect(cardMilestone([])).toBeNull();
  });

  it('takes the newest instant', () => {
    const older = at(bingo('a', 0), '2026-03-01T00:00:00Z');
    const newer = at(line('b', 1), '2026-06-01T00:00:00Z');
    expect(cardMilestone([older, newer])).toEqual(newer);
    expect(cardMilestone([newer, older])).toEqual(newer);
  });

  // The whole point. One tap writes a Tile, its Lines and the Blackout in one transaction,
  // and `now()` is the transaction's clock — so they share a `created_at` exactly and row
  // order inside the group is whatever the query plan felt like. "The last row" could put
  // "Column 4" on the card the day somebody finished all twenty-five squares.
  it('takes the loudest of a group written by the same tap, in either row order', () => {
    const stamp = '2026-12-20T09:00:00Z';
    const group = [at(line('a', 4), stamp), at(bingo('b', 9), stamp), at(blackout('c'), stamp)];
    expect(cardMilestone(group)?.type).toBe('blackout');
    expect(cardMilestone([...group].reverse())?.type).toBe('blackout');
  });

  it('ignores a Tile that shares the instant a Line was closed in', () => {
    const stamp = '2026-12-20T09:00:00Z';
    expect(cardMilestone([at(tile('a'), stamp), at(line('b', 2), stamp)])?.type).toBe(
      'line_completed',
    );
  });
});

describe('milestoneHeadline (§4 Milestone card)', () => {
  it('leaves Tiles off the card — twenty-five of them would stop it being read', () => {
    expect(milestoneHeadline(tile('a'), lineName)).toBeNull();
  });

  it('names the Line a Bingo closed', () => {
    expect(milestoneHeadline(bingo('a', 1), lineName)).toBe('Bingo — row 2');
  });

  it('names a later Line plainly', () => {
    expect(milestoneHeadline(line('a', 5), lineName)).toBe('Column 1');
  });

  it('says Blackout and nothing more', () => {
    expect(milestoneHeadline(blackout('a'), lineName)).toBe('Blackout');
  });
});
