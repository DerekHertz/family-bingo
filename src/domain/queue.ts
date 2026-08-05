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
  /**
   * ISO 8601, minted on the device at the moment of the tap — and already clamped forward
   * past the Board's seal by `occurredAtFor` (`src/domain/increment.ts`), because a handset
   * whose clock reads earlier than the seal would otherwise have every one of these refused
   * with `PT403` and dropped at the next drain.
   */
  readonly occurredAt: string;
  /**
   * How many drains have failed on this row. Kept for diagnosis, never for a decision.
   *
   * **Deliberately not an escalation counter, and this is the asymmetry that decides it.**
   * A tap kept forever costs a request per drain and is bounded by `MAX_QUEUED`; a tap
   * dropped is a walk somebody took that the app has decided to forget, and is bounded by
   * nothing. So there is no attempt count at which a row that has never been *refused*
   * becomes safe to discard — the only thing that makes a drop safe is a server saying
   * these exact bytes are bad, which is what `classifyDelivery` reads and this number
   * cannot. The blocked-queue problem it looks like it should solve is `sameForEveryRow`'s
   * instead: the drain moves past a row-specific failure rather than stopping on it.
   */
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
const NO_SUCH_PARENT = '23503'; // foreign_key_violation: the Tile or the Member is gone
const MISSING_VALUE = '23502'; // not_null_violation: a column this build did not send

/**
 * What one drain attempt was told, in the two fields that carry meaning plus the one that
 * says whether there was a failure at all.
 *
 * `failed` is not redundant with the other two, and the case it exists for is nastier than
 * it looks. postgrest-js sets `error` on an **ok** response whose body is not JSON —
 * `{ status: 200, error: { message: <the body> }, data: null }`, with no `code` — which is
 * what a TLS-inspecting proxy or a captive-portal interstitial produces. Without this
 * field that response reads as a 201 with nothing to report, the tap is deleted from the
 * queue as landed, and it is on no server anywhere.
 */
export interface DeliveryOutcome {
  /**
   * The HTTP status PostgREST answered with — `null` or `0` when the request never got an
   * answer.
   */
  status: number | null | undefined;
  /** The SQLSTATE from the error body, `''` when there wasn't one. */
  code: string;
  /** Whether the response carried an error object at all, whatever its status said. */
  failed: boolean;
}

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
 * **`drop` is enumerated and `keep` is the fallthrough, and it used to be the other way
 * round.** That inversion is the whole shape of this function now, because the two errors
 * are not the same size: a kept tap costs one request per drain and is bounded by
 * `MAX_QUEUED`; a dropped tap is a walk somebody took that the app has decided to forget,
 * and is bounded by nothing. So a status only drops when it is a statement about *these
 * exact bytes*, which the queue can only ever send again unchanged.
 *
 * The status that made the inversion necessary is **404**. It was dropped as "a Tile that
 * was removed", and that reading is wrong twice over: a missing Tile is a foreign-key
 * violation, which PostgREST answers **409** with `23503` (handled by code below), and
 * every 404 this request can actually receive is about the **route** — `PGRST205`, "could
 * not find the table in the schema cache", during the seconds after a migration deploy,
 * or a paused project. A migration ships, eleven taps queued over a week foreground into
 * the reload window, and all eleven are deleted. §17's acceptance test fails in production
 * and nothing reports it. This repo has already hit the sibling `PGRST202` for exactly
 * that reason (docs/HANDOFF.md).
 */
export const classifyDelivery = (outcome: DeliveryOutcome): Delivery => {
  const { status, code, failed } = outcome;

  // Codes first. PostgREST maps `PT403` to HTTP 403 and `42501` to 403 as well, so a
  // frozen Year and an expired token arrive as the same status and only the code tells
  // them apart — which makes the drop deliberate rather than a side effect of a range.
  //
  // (Phrased around the obvious wording on purpose: `src/domain/boundaries.test.ts` greps
  // this directory for import syntax, and two quoted phrases with the natural preposition
  // between them read to it as a module specifier. `src/domain/feed.ts` carries the same
  // note for the same reason.)
  //
  // `23503` is here because PostgREST maps a foreign-key violation to **409**, the same
  // status as the primary-key collision below — so without it a tap for a Tile that no
  // longer exists fell to the status branch and was reported as a *landing*. Online that
  // then uploaded a photograph of a child against an Increment that does not exist.
  if (
    code === BACKDATED ||
    code === REFUSED ||
    code === NO_SUCH_PARENT ||
    code === MISSING_VALUE
  ) {
    return 'drop';
  }
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

  // A 2xx **with an error on it** is not a landing. See `DeliveryOutcome.failed`: nothing
  // in the status or the code distinguishes a proxy's HTML interstitial from a 200 that
  // meant it, and reporting the tap as delivered deletes it from the only place it exists.
  if (status >= 200 && status < 300) return failed ? 'keep' : 'delivered';
  // 409 is the primary-key collision PostgREST answers when the `Prefer` header went
  // missing (api.md §5.1). The row exists; the queue's work is done. Reached only after
  // `23503` above has taken the other thing a 409 can mean.
  if (status === 409) return 'delivered';

  // The three refusals of *these bytes*, and the only statuses that drop without a code.
  // 400 — PostgREST would not parse the body. 413 — it is too large, and it will be too
  // large again. 422 — it parsed and was unprocessable. Nothing about a retry changes any
  // of the three, because the queue can only ever send the same row.
  if (status === 400 || status === 413 || status === 422) return 'drop';

  // Everything else is kept, and the ones worth naming are:
  //
  //   - **5xx**, the server unwell, and **429**, the server asking for a pause.
  //   - **401**, an expired access token that supabase-js refreshes on its own. Dropping a
  //     Member's taps because a session lapsed overnight would be losing real progress to
  //     a solved problem.
  //   - **403 with no code**, which is not RLS — RLS arrives as `42501` and is dropped
  //     above. A bare 403 is a gateway or a WAF, and it is not a fact about the row.
  //   - **404**, the route rather than the row. See the note on this function.
  return 'keep';
};

/**
 * Will the next row get this same answer? — which is the only question a drain loop needs
 * in order to know whether to stop.
 *
 * A drain sends one request per row (see `drainQueue`), and it used to `break` on the
 * first `keep`. That is right for a dropped connection, where the remaining requests would
 * each spend a round trip learning the identical thing, and wrong for anything the server
 * said about *one* row: a single such row sat at the head of the queue and every tap
 * behind it waited on a failure that had nothing to do with it, on every drain, forever.
 *
 * So the loop asks this instead. `true` for the answers that are a fact about the
 * connection, the route, the session or the server — no answer at all, a 5xx, a 429, a
 * 401, a 404, and a 2xx carrying a proxy's body — and `false` for anything else, where the
 * drain moves on to the next row rather than treating one bad row as the end of the queue.
 *
 * Only meaningful for a `keep`; `delivered` and `drop` both take the row out of the queue
 * and the loop carries on regardless.
 */
export const sameForEveryRow = (outcome: DeliveryOutcome): boolean => {
  const { status, failed } = outcome;
  if (status === null || status === undefined || status === 0) return true;
  if (status >= 500) return true;
  if (status === 429 || status === 401 || status === 404 || status === 403) return true;
  // The captive portal again: it answers every request the same way, so there is no point
  // asking it thirty more times.
  if (status >= 200 && status < 300 && failed) return true;
  return false;
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
