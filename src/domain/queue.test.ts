import { describe, expect, it } from 'vitest';
import {
  MAX_QUEUED,
  afterDrain,
  classifyDelivery,
  isQueuedTap,
  queuedCopy,
  readTaps,
  withTap,
  type Delivery,
  type QueuedTap,
} from './queue';

const tap = (id: string, over: Partial<QueuedTap> = {}): QueuedTap => ({
  id,
  tileId: 'tile-1',
  memberId: 'member-1',
  note: null,
  occurredAt: '2027-03-04T10:00:00.000Z',
  attempts: 0,
  ...over,
});

/**
 * The whole point of this module. Every branch, named by what actually produces it —
 * because the failure mode is invisible: a queue that retries a refusal retries it on
 * every launch, forever, and nothing ever shows a Member that it is happening.
 */
describe('classifyDelivery — api.md §5.1', () => {
  const cases: [string, { status: number | null | undefined; code: string }, Delivery][] = [
    ['201, the ordinary landing', { status: 201, code: '' }, 'delivered'],
    ['200', { status: 200, code: '' }, 'delivered'],
    ['204, which upsert answers with Prefer: return=minimal', { status: 204, code: '' }, 'delivered'],

    // Not delivered, and a later attempt could succeed.
    ['no answer at all — airplane mode', { status: null, code: '' }, 'keep'],
    ['status 0, how supabase-js reports a fetch failure', { status: 0, code: '' }, 'keep'],
    ['undefined status, from a client path that never set one', { status: undefined, code: '' }, 'keep'],
    ['500', { status: 500, code: '' }, 'keep'],
    ['502 from a proxy in front of PostgREST', { status: 502, code: '' }, 'keep'],
    ['503', { status: 503, code: '' }, 'keep'],
    ['429, which is the server asking for a pause', { status: 429, code: '' }, 'keep'],
    ['401, because supabase-js refreshes the token on its own', { status: 401, code: '' }, 'keep'],

    // Not delivered, and no attempt ever will be.
    ['403 + 42501 — the Year froze while the queue was offline', { status: 403, code: '42501' }, 'drop'],
    ['403 + PT403 — an Increment predating the seal', { status: 403, code: 'PT403' }, 'drop'],
    ['403 with no code', { status: 403, code: '' }, 'drop'],
    ['400 on a body PostgREST would not parse', { status: 400, code: '' }, 'drop'],
    ['404 on a Tile that is no longer there', { status: 404, code: '' }, 'drop'],
    ['422', { status: 422, code: '' }, 'drop'],

    // Already there, which is a landing however it is spelled.
    ['409 on the primary key, when the Prefer header went missing', { status: 409, code: '' }, 'delivered'],
    ['23505, the same thing said in SQLSTATE', { status: 409, code: '23505' }, 'delivered'],
  ];

  it.each(cases)('%s', (_name, outcome, expected) => {
    expect(classifyDelivery(outcome)).toBe(expected);
  });

  it('reads the SQLSTATE even when the status is missing', () => {
    // Not every client path surfaces a status. The code is the part that carries the
    // meaning, so it is checked first and it wins.
    expect(classifyDelivery({ status: null, code: '42501' })).toBe('drop');
    expect(classifyDelivery({ status: undefined, code: 'PT403' })).toBe('drop');
  });

  it('never answers "keep" to a 403, in any spelling', () => {
    // The single most expensive mistake this file can make. A Year does not unfreeze.
    for (const code of ['', '42501', 'PT403', 'anything']) {
      expect(classifyDelivery({ status: 403, code })).not.toBe('keep');
    }
  });

  it('never answers "drop" to something that was never sent', () => {
    // The other direction, and it loses a Member's real progress rather than wasting
    // battery: a tap that got no answer may not have landed.
    for (const status of [null, undefined, 0]) {
      expect(classifyDelivery({ status, code: '' })).toBe('keep');
    }
  });
});

describe('what survives being read back off the disk', () => {
  it('accepts a tap', () => {
    expect(isQueuedTap(tap('a'))).toBe(true);
  });

  it('accepts a note, and accepts none', () => {
    expect(isQueuedTap(tap('a', { note: 'saw the herons' }))).toBe(true);
    expect(isQueuedTap(tap('a', { note: null }))).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'not a tap'],
    ['a number', 3],
    ['an array', []],
    ['an empty object', {}],
    ['a missing id', { ...tap('a'), id: undefined }],
    ['an empty id', { ...tap('a'), id: '' }],
    ['a missing tile', { ...tap('a'), tileId: undefined }],
    ['a missing member', { ...tap('a'), memberId: undefined }],
    ['a missing occurredAt', { ...tap('a'), occurredAt: undefined }],
    ['a note that is a number', { ...tap('a'), note: 7 }],
    ['attempts that are not a number', { ...tap('a'), attempts: 'many' }],
    ['attempts that are NaN', { ...tap('a'), attempts: Number.NaN }],
  ])('refuses %s', (_name, value) => {
    expect(isQueuedTap(value)).toBe(false);
  });

  it('keeps the good rows out of a file that is partly rubbish', () => {
    expect(readTaps([tap('a'), null, { half: 'written' }, tap('b')]).map((t) => t.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('answers an empty queue for anything that is not a list', () => {
    // An app that will not open because of its own queue is worse than any tap in it.
    expect(readTaps(null)).toEqual([]);
    expect(readTaps(undefined)).toEqual([]);
    expect(readTaps('[')).toEqual([]);
    expect(readTaps({ taps: [] })).toEqual([]);
  });
});

describe('adding a tap', () => {
  it('appends in the order tapped', () => {
    const one = withTap([], tap('a'));
    const two = withTap(one.queue, tap('b'));
    expect(two.queue.map((t) => t.id)).toEqual(['a', 'b']);
    expect(two.accepted).toBe(true);
  });

  it('is idempotent on the id, so one tap can never show as two', () => {
    const first = withTap([], tap('a'));
    const again = withTap(first.queue, tap('a', { note: 'a later edit that never happens' }));
    expect(again.queue).toHaveLength(1);
    expect(again.accepted).toBe(true);
    // Append-only: the first version of the row is the one that stands (§11.3).
    expect(again.queue[0]?.note).toBeNull();
  });

  it('refuses past the cap rather than growing or discarding silently', () => {
    const full = Array.from({ length: MAX_QUEUED }, (_, i) => tap(`t${i}`));
    const over = withTap(full, tap('one-more'));
    expect(over.accepted).toBe(false);
    expect(over.queue).toHaveLength(MAX_QUEUED);
    expect(over.queue.map((t) => t.id)).not.toContain('one-more');
  });

  it('still takes a duplicate at the cap, because it adds nothing', () => {
    const full = Array.from({ length: MAX_QUEUED }, (_, i) => tap(`t${i}`));
    expect(withTap(full, tap('t0')).accepted).toBe(true);
  });

  it('does not mutate the queue it was given', () => {
    const before: QueuedTap[] = [tap('a')];
    withTap(before, tap('b'));
    expect(before).toHaveLength(1);
  });
});

describe('what is left after a drain', () => {
  const queue = [tap('a'), tap('b'), tap('c')];

  it('removes what landed and what can never land', () => {
    const verdicts = new Map<string, Delivery>([
      ['a', 'delivered'],
      ['b', 'drop'],
      ['c', 'keep'],
    ]);
    expect(afterDrain(queue, verdicts).map((t) => t.id)).toEqual(['c']);
  });

  it('counts an attempt against a row it kept', () => {
    expect(afterDrain(queue, new Map([['c', 'keep']])).find((t) => t.id === 'c')?.attempts).toBe(1);
  });

  it('leaves a row the drain never reached untouched', () => {
    // A drain that stops halfway — the app backgrounds, the network dies — must not count
    // an attempt against rows it never sent.
    const left = afterDrain(queue, new Map([['a', 'delivered']]));
    expect(left.map((t) => t.id)).toEqual(['b', 'c']);
    expect(left.every((t) => t.attempts === 0)).toBe(true);
  });

  it('empties the queue when a frozen Year refuses every row at once', () => {
    // RLS is checked on the proposed row before ON CONFLICT discards it, so a freeze
    // fails the whole queue — including taps that landed months ago (api.md §5.1).
    const frozen = new Map<string, Delivery>(queue.map((t) => [t.id, 'drop']));
    expect(afterDrain(queue, frozen)).toEqual([]);
  });
});

describe('what the sheet says while taps wait (§1.1)', () => {
  it('says nothing when nothing is waiting', () => {
    expect(queuedCopy(0)).toBeNull();
    expect(queuedCopy(-1)).toBeNull();
  });

  it('counts in words a person would use', () => {
    expect(queuedCopy(1)).toContain('One tap');
    expect(queuedCopy(3)).toContain('3 taps');
  });

  it('never scolds and never promises a time (§0.3)', () => {
    for (const count of [1, 2, 40]) {
      const line = queuedCopy(count) ?? '';
      expect(line.toLowerCase()).not.toMatch(/error|failed|problem|lost|retry|soon|shortly/);
    }
  });
});
