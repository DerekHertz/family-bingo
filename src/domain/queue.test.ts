import { describe, expect, it } from 'vitest';
import {
  MAX_QUEUED,
  afterDrain,
  classifyDelivery,
  isQueuedTap,
  queuedCopy,
  readTaps,
  sameForEveryRow,
  withTap,
  type Delivery,
  type DeliveryOutcome,
  type QueuedTap,
} from './queue';

/**
 * An answer, spelled the way `send()` spells one.
 *
 * `failed` defaults to what supabase-js actually does — an error object accompanies every
 * non-2xx and every request that got no answer — so a case only has to state it when the
 * point of the case is that the two disagree.
 */
const answer = (
  status: number | null | undefined,
  code = '',
  failed = code !== '' || status == null || status === 0 || status >= 300,
): DeliveryOutcome => ({ status, code, failed });

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
  const cases: [string, DeliveryOutcome, Delivery][] = [
    ['201, the ordinary landing', answer(201), 'delivered'],
    ['200', answer(200), 'delivered'],
    ['204, which upsert answers with Prefer: return=minimal', answer(204), 'delivered'],

    // Not delivered, and a later attempt could succeed.
    ['no answer at all — airplane mode', answer(null), 'keep'],
    ['status 0, how supabase-js reports a fetch failure', answer(0), 'keep'],
    ['undefined status, from a client path that never set one', answer(undefined), 'keep'],
    ['500', answer(500), 'keep'],
    ['502 from a proxy in front of PostgREST', answer(502), 'keep'],
    ['503', answer(503), 'keep'],
    ['429, which is the server asking for a pause', answer(429), 'keep'],
    ['401, because supabase-js refreshes the token on its own', answer(401), 'keep'],

    // Not delivered, and no attempt ever will be.
    ['403 + 42501 — the Year froze while the queue was offline', answer(403, '42501'), 'drop'],
    ['403 + PT403 — an Increment predating the seal', answer(403, 'PT403'), 'drop'],
    ['400 on a body PostgREST would not parse', answer(400), 'drop'],
    ['413 on a body that will be too large again', answer(413), 'drop'],
    ['422', answer(422), 'drop'],
    ['23502 — a column this build did not send', answer(400, '23502'), 'drop'],

    // Already there, which is a landing however it is spelled.
    ['409 on the primary key, when the Prefer header went missing', answer(409), 'delivered'],
    ['23505, the same thing said in SQLSTATE', answer(409, '23505'), 'delivered'],
  ];

  it.each(cases)('%s', (_name, outcome, expected) => {
    expect(classifyDelivery(outcome)).toBe(expected);
  });

  it('reads the SQLSTATE even when the status is missing', () => {
    // Not every client path surfaces a status. The code is the part that carries the
    // meaning, so it is checked first and it wins.
    expect(classifyDelivery(answer(null, '42501'))).toBe('drop');
    expect(classifyDelivery(answer(undefined, 'PT403'))).toBe('drop');
  });

  it('never answers "keep" to a 403 that RLS sent', () => {
    // The single most expensive mistake in this direction. A Year does not unfreeze, and
    // a queue that retries a frozen Year retries it on every launch forever.
    for (const code of ['42501', 'PT403']) {
      expect(classifyDelivery(answer(403, code))).toBe('drop');
    }
  });

  it('keeps a bare 403, because RLS always names itself', () => {
    // Was `drop`. PostgREST answers an RLS refusal with `42501` in the body — a 403 with
    // no code at all is a gateway or a WAF in front of it, which is a fact about the
    // request's route and not about the tap, and which stops being true.
    expect(classifyDelivery(answer(403, ''))).toBe('keep');
  });

  it('keeps a 404, because it is the route and never the row', () => {
    // The defect this test exists to stop coming back. 404 was dropped as "a Tile that was
    // removed" — but a missing Tile is a foreign-key violation, which PostgREST answers
    // 409 with `23503`. Every 404 this request can receive is `PGRST205`, "could not find
    // the table in the schema cache", during the seconds after a migration deploy, or a
    // paused project. Dropping it silently deletes every queued tap on the handset.
    expect(classifyDelivery(answer(404))).toBe('keep');
  });

  it('drops a 409 that is a foreign-key violation, not just the PK collision', () => {
    // PostgREST maps `23503` to 409 as well, so without the code this read as a landing —
    // and in the online path that then uploaded a photo against an Increment that does
    // not exist.
    expect(classifyDelivery(answer(409, '23503'))).toBe('drop');
  });

  it('does not believe a 2xx that came with an error on it', () => {
    // postgrest-js sets `error` on an *ok* response whose body is not JSON: a captive
    // portal's login page, a TLS-inspecting proxy's interstitial. Status 200, no code, and
    // the tap is on no server anywhere. Reporting it as delivered deletes it from the only
    // place it exists.
    expect(classifyDelivery({ status: 200, code: '', failed: true })).toBe('keep');
    expect(classifyDelivery({ status: 201, code: '', failed: true })).toBe('keep');
  });

  it('never answers "drop" to something that was never sent', () => {
    // The other direction, and it loses a Member's real progress rather than wasting
    // battery: a tap that got no answer may not have landed.
    for (const status of [null, undefined, 0]) {
      expect(classifyDelivery(answer(status))).toBe('keep');
    }
  });

  it('drops only the statuses that are about these exact bytes', () => {
    // The invariant behind the rewrite: `drop` is enumerated and `keep` is the
    // fallthrough, because a kept tap is bounded by MAX_QUEUED and a dropped tap is
    // bounded by nothing. Any 4xx nobody has thought about yet has to be kept.
    for (const status of [402, 405, 406, 410, 415, 418, 428, 431, 451]) {
      expect(classifyDelivery(answer(status))).toBe('keep');
    }
  });
});

/**
 * Whether the drain should stop, which used to be "the first `keep`" and is now a question
 * about what the answer was *about*.
 */
describe('sameForEveryRow — when the drain should stop rather than move on', () => {
  it('stops for the answers that are about the connection or the route', () => {
    for (const outcome of [
      answer(null),
      answer(undefined),
      answer(0),
      answer(500),
      answer(503),
      answer(429),
      answer(401),
      answer(404),
      answer(403),
      { status: 200, code: '', failed: true },
    ]) {
      expect(sameForEveryRow(outcome)).toBe(true);
    }
  });

  it('moves on for an answer the server gave about one row', () => {
    // A single row the server keeps refusing used to sit at the head of the queue and
    // block every tap behind it, on every drain, forever — because the loop broke on any
    // `keep` at all.
    for (const outcome of [answer(405), answer(410), answer(418), answer(451)]) {
      expect(sameForEveryRow(outcome)).toBe(false);
    }
  });

  it('does not stop on a plain landing', () => {
    expect(sameForEveryRow(answer(201))).toBe(false);
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
