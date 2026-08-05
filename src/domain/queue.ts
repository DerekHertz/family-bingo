/**
 * The offline queue's arithmetic (PRD §17, api.md §5.1).
 *
 * > Offline queue covers **Increments only**. Authoring, voting, and invites remain
 * > online-only. Deliberately narrow. (§17.1)
 *
 * The narrowness is a property of the schema rather than a convention: `increments.id` has
 * no server default, so the *device* mints the primary key (§11.2), and `increments` has
 * no UPDATE grant, so a replay can only ever be discarded. That pair is the whole conflict
 * story (§17.4) — there is no merge, no last-write-wins, no vector clock. Boards and votes
 * have neither property, which is why they stay online-only.
 *
 * Everything here is pure. The disk and the draining are `lib/queue.ts`; this is the part
 * that decides **whether a tap is still owed**, and it is the part worth testing
 * exhaustively, because getting it wrong is not a visible bug. A queue that retries a
 * refusal retries it silently, on every launch, until the app is deleted.
 */

/**
 * One tap, as it waits.
 *
 * `occurredAt` is the reason this is not just an id. A tap held for three days and replayed
 * on Thursday happened on Monday, and `useRecentIncrements` orders by `occurred_at`
 * precisely so that a Member's week reads in the order they lived it. `stamp_increment()`
 * pulls a *future* value back to `now()` and refuses anything before the Board's seal
 * (`PT403`), so the server still has the last word — but a queue that sent nothing would
 * have every replayed tap stamped with the moment the network came back.
 */
export interface QueuedTap {
  readonly id: string;
  readonly tileId: string;
  readonly memberId: string;
  readonly note: string | null;
  /** ISO 8601, minted on the device at the moment of the tap. */
  readonly occurredAt: string;
  /** How many drains have failed on this row. Kept for diagnosis, never for a decision. */
  readonly attempts: number;
}

/**
 * A ceiling, and it is a corruption backstop rather than a product rule.
 *
 * A queued tap is about 200 bytes. A family of six logs ~3,300 Increments a year between
 * them (§15.3), so one device's whole year is under 150 KB and this bound is roughly six
 * years of never once having a connection. Reaching it means something else is wrong —
 * a drain that classifies wrongly and keeps everything, most likely — and the honest
 * response is to refuse the tap and say so, rather than to grow a file on a Member's phone
 * without limit or to silently discard the oldest thing they did.
 */
export const MAX_QUEUED = 2000;

/**
 * What a drain attempt learned about one row.
 *
 * Three answers, not two, and the third is the one api.md §5.1 says is "worth stating
 * because it is not obvious".
 */
export type Delivery =
  /** The row is on the server. Take it out of the queue. */
  | 'delivered'
  /** Not delivered, and a later attempt could succeed. Keep it. */
  | 'keep'
  /** Not delivered, and no attempt ever will be. Take it out of the queue. */
  | 'drop';

/** SQLSTATEs the client can be handed for a tap. Matched on `code`, never on message text. */
const BACKDATED = 'PT403'; // stamp_increment(): an Increment predating the seal (§11.5)
const REFUSED = '42501'; // RLS: a frozen Year, or somebody else's Board
const ALREADY_THERE = '23505'; // unique_violation on the primary key

/**
 * The one decision this module exists for (api.md §5.1's table).
 *
 * | Response | Meaning | What the queue does |
 * |---|---|---|
 * | Network error, 5xx | Not delivered | Retry on reconnect |
 * | `403` on a **frozen** Year | The Year closed while the queue was offline | **Drop the tap** |
 *
 * The second half needs saying twice, because it is where a well-meaning queue breaks:
 * **RLS is checked on the proposed row before `ON CONFLICT` discards it.** So once a Year
 * freezes, a drain fails on *every* queued row — including taps that landed months ago and
 * whose only remaining trace is that the device never saw the response. Nothing is written
 * either way. The difference is that a queue treating 403 as retryable retries it on every
 * launch, forever, for a Year that does not unfreeze.
 *
 * Dropping a row that had already landed costs nothing, and that is not luck: §17.4's
 * idempotency means the queue never knows which of its rows are already on the server, so
 * "drop" has to be safe for both cases or it could not be used at all.
 *
 * @param outcome `status` is the HTTP status PostgREST answered with — `null` or `0` when
 * the request never got an answer — and `code` is the SQLSTATE from the error body, `''`
 * when there wasn't one. Both, because they disagree: a network failure has a code of `''`
 * and no status, while `PT403` arrives as a 403 whose meaning is entirely in the code.
 */
export const classifyDelivery = (outcome: {
  status: number | null | undefined;
  code: string;
}): Delivery => {
  const { status, code } = outcome;

  // Codes first. PostgREST maps `PT403` to HTTP 403 and `42501` to 403 as well, so a
  // frozen Year and an expired token arrive as the same status and only the code tells
  // them apart — which makes the drop deliberate rather than a side effect of a range.
  //
  // (Phrased around the obvious wording on purpose: `src/domain/boundaries.test.ts` greps
  // this directory for import syntax, and two quoted phrases with the natural preposition
  // between them read to it as a module specifier. `src/domain/feed.ts` carries the same
  // note for the same reason.)
  if (code === BACKDATED || code === REFUSED) return 'drop';
  // The row is already there under the id this device minted. That is a landing, not a
  // failure — it is exactly what §17.4 promises, arriving without the `ignore-duplicates`
  // header for some reason. Keeping it queued would retry it forever against a row that
  // can never be anything but a duplicate.
  if (code === ALREADY_THERE) return 'delivered';

  // No answer at all: a dropped connection, a timeout, airplane mode. supabase-js reports
  // this as a status of 0 and an empty code, which cannot be told apart at all from a
  // request that was never sent — and must be treated as one. The tap may or may not have
  // landed, and replaying it is free (§17.4).
  if (status === null || status === undefined || status === 0) return 'keep';

  if (status >= 200 && status < 300) return 'delivered';
  // 409 is the primary-key collision PostgREST answers when the `Prefer` header went
  // missing (api.md §5.1). The row exists; the queue's work is done.
  if (status === 409) return 'delivered';
  // The server is unwell, or is asking for a pause. Both pass.
  if (status >= 500) return 'keep';
  if (status === 429) return 'keep';
  // An expired access token, which supabase-js refreshes on its own. The next drain
  // carries a valid one; dropping a Member's taps because a session lapsed overnight
  // would be losing real progress to a solved problem.
  if (status === 401) return 'keep';

  // Every other 4xx — 400 on a malformed body, 403 without a code, 404 on a Tile that was
  // removed — is a rejection of these exact bytes, and the queue can only ever send these
  // exact bytes again.
  return 'drop';
};

/**
 * Is this a tap, and not something an older build left on the disk?
 *
 * The queue is JSON on a device that upgrades under it. A field added next year is read
 * by a build that does not know it; a field removed is read by a build that requires it;
 * and a half-written file is read by both. None of that is allowed to throw inside a drain
 * that runs at launch — an app that will not open because of its own queue is worse than
 * any tap it might drop — so the file is filtered rather than trusted, and a row that no
 * longer parses is discarded quietly.
 */
export const isQueuedTap = (value: unknown): value is QueuedTap => {
  if (typeof value !== 'object' || value === null) return false;
  const tap = value as Record<string, unknown>;
  return (
    typeof tap.id === 'string' &&
    tap.id !== '' &&
    typeof tap.tileId === 'string' &&
    tap.tileId !== '' &&
    typeof tap.memberId === 'string' &&
    tap.memberId !== '' &&
    typeof tap.occurredAt === 'string' &&
    tap.occurredAt !== '' &&
    (tap.note === null || typeof tap.note === 'string') &&
    typeof tap.attempts === 'number' &&
    Number.isFinite(tap.attempts)
  );
};

/** Everything on the disk that is still a tap, in the order it was written. */
export const readTaps = (value: unknown): QueuedTap[] =>
  Array.isArray(value) ? value.filter(isQueuedTap) : [];

/**
 * Add a tap to the queue.
 *
 * **Idempotent on the id**, like everything else about an Increment (§17.4). Nothing calls
 * this twice for one tap today — react-query does not retry a mutation by default, and
 * every press mints a fresh uuid — but the queue is the one place where a duplicate would
 * be *visible*: the server's upsert collapses two identical rows into one, while two rows
 * sitting here show a Member two walks for one tap until the drain gets to them. A
 * structure whose correctness depends on nobody ever calling it twice is a structure
 * waiting for the caller who does.
 *
 * Returns `accepted: false` at the cap rather than silently dropping either end — see
 * `MAX_QUEUED`.
 */
export const withTap = (
  queue: readonly QueuedTap[],
  tap: QueuedTap,
): { queue: QueuedTap[]; accepted: boolean } => {
  if (queue.some((queued) => queued.id === tap.id)) {
    return { queue: [...queue], accepted: true };
  }
  if (queue.length >= MAX_QUEUED) return { queue: [...queue], accepted: false };
  return { queue: [...queue, tap], accepted: true };
};

/** What is left after a drain: the kept rows, with their attempt counts moved on. */
export const afterDrain = (
  queue: readonly QueuedTap[],
  verdicts: ReadonlyMap<string, Delivery>,
): QueuedTap[] =>
  queue
    .filter((tap) => (verdicts.get(tap.id) ?? 'keep') === 'keep')
    .map((tap) =>
      verdicts.has(tap.id) ? { ...tap, attempts: tap.attempts + 1 } : tap,
    );

/**
 * What the sheet says while taps are waiting (§1.1 — `ink2` and plain words, never colour).
 *
 * A statement of where the taps are, not a warning and not a spinner. §0.3: nothing
 * scolds, and being underground is not the Member's doing. It deliberately does not
 * promise *when* — "as soon as you're online" is a promise about a network, and the app
 * has no idea.
 */
export const queuedCopy = (count: number): string | null => {
  if (count <= 0) return null;
  return count === 1
    ? 'One tap is saved on this phone and will sync when you’re back online.'
    : `${count} taps are saved on this phone and will sync when you’re back online.`;
};
