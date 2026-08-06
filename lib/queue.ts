/**
 * The offline queue — the disk, and the draining (PRD §17, api.md §5.1).
 *
 * The decisions are in `src/domain/queue.ts`, where they can be tested exhaustively in
 * milliseconds. This file is the two things that cannot be: a file on a handset, and an
 * HTTP request per row.
 *
 * ## Why AsyncStorage
 *
 * §17.3 is one sentence — "the queue persists across app restarts" — and it is what rules
 * out React state, a module-level array, and react-query's cache alone.
 *
 *   - **Not `expo-secure-store`.** §1.4 puts *session tokens* in the keychain, and that is
 *     a boundary worth keeping narrow: a keychain item survives an app uninstall on iOS,
 *     it is size-limited to 2048 bytes per value (which is why `lib/supabase.ts` chunks
 *     the session by hand), and there is nothing secret in "this Member tapped their walk
 *     goal at 10am". Putting a queue there would cost the chunking dance for no threat it
 *     answers.
 *   - **Not the file system directly.** It would work — `expo-file-system` is already a
 *     dependency for slice 16 — but it means owning the atomicity, the encoding and the
 *     "what if the app died halfway through a write" question that AsyncStorage's
 *     single-key `setItem` already answers.
 *   - **AsyncStorage**, which is the ordinary answer in this ecosystem, lives inside the
 *     app's private container (deleted with the app), and is what
 *     `@tanstack/query-async-storage-persister` is already going to need for §17.5. One
 *     dependency, two uses.
 *
 * The payload is the Member's own taps: an id, a Tile, a Member, a timestamp, and possibly
 * a note they wrote. It is Family-scoped data at rest on the device it was typed on, which
 * is the same posture as the persisted query cache beside it (`lib/persist.ts`).
 *
 * ## Increments only
 *
 * §17.1, and §17.4 explains why the scope is narrow rather than cautious: idempotency here
 * is a property of the *schema* — a client-minted primary key and no UPDATE grant — so the
 * queue needs no merge semantics at all. Boards, Ballots and Invitations have neither
 * property. Do not extend this to them.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import {
  afterDrain,
  classifyDelivery,
  readTaps,
  sameForEveryRow,
  withTap,
  type Delivery,
  type DeliveryOutcome,
  type QueuedTap,
} from '../src/domain/queue';
import { failure } from './failure';
import { supabase } from './supabase';

/**
 * One key, versioned in its name.
 *
 * A future change to the row shape gets a new key rather than a migration: the old one is
 * left where it is and ignored, which loses at most the taps a Member made while offline
 * across an app update. `readTaps` already filters unreadable rows, so this is belt and
 * braces — but a queue that crashes a launch is worse than a queue that forgets.
 */
const KEY = 'family-bingo.increments.v1';

/**
 * The in-memory copy, and the only thing the UI reads synchronously.
 *
 * `null` means "not loaded from disk yet", which is different from "empty" — a drain that
 * ran before the load would send nothing and then overwrite the file with nothing.
 */
let cache: QueuedTap[] | null = null;
let snapshot = 0;
const listeners = new Set<() => void>();

const publish = () => {
  snapshot = cache?.length ?? 0;
  for (const listener of listeners) listener();
};

/**
 * Every read-modify-write goes through one promise chain.
 *
 * The two drain triggers can fire within a frame of each other — a cold launch that is
 * also a foreground — and a tap can land in the middle of a drain. Without this, two
 * `setItem`s race on the same key and the loser's taps are simply gone. A chained promise
 * is enough: there is one JavaScript thread and the critical sections are microseconds of
 * array work around one `await`.
 */
let lock: Promise<unknown> = Promise.resolve();

const exclusively = <T,>(work: () => Promise<T>): Promise<T> => {
  const next = lock.then(work, work);
  // Swallowed here only so one failure cannot poison the chain for every later caller;
  // the real result is still returned to whoever asked.
  lock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

const load = async (): Promise<QueuedTap[]> => {
  if (cache !== null) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw === null ? [] : readTaps(JSON.parse(raw));
  } catch {
    // Unparseable, or storage unavailable. An empty queue is the only safe answer: the
    // app has to open (§17.5 exists so that it opens to content), and the alternative is
    // an exception on the launch path.
    cache = [];
  }
  publish();
  return cache;
};

const save = async (taps: QueuedTap[]): Promise<void> => {
  cache = taps;
  publish();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(taps));
  } catch {
    // The taps are still in memory and still optimistic on screen. Losing the *file* on
    // a full disk is bad; failing the tap over it would be worse.
  }
};

/** What is waiting, loading it from disk if this is the first ask. */
export const queuedTaps = (): Promise<QueuedTap[]> => exclusively(load);

/**
 * Hold a tap for later. `false` means it was refused at `MAX_QUEUED` — see the constant.
 *
 * Idempotent on the id, which matters more than it looks: react-query retries a mutation,
 * so one tap can arrive here three times, and three rows in the queue would show a Member
 * three walks until the drain collapsed them.
 */
/**
 * **The queue does not run in a browser.**
 *
 * §17.1 scopes it to Increments because they are the one write with the properties that
 * make a replay safe. None of that changes on web — what changes is the storage: a queued
 * tap would sit in `localStorage`, holding a Member's note and a Tile id on a machine that
 * may not be theirs, for as long as it takes to reconnect. A browser is also online almost
 * whenever it is open, so the feature earns very little there.
 *
 * Refusing rather than pretending is the honest failure: `useLogIncrement` treats a
 * refusal as "this tap is not saved anywhere", rolls the optimistic ring back, and says so
 * (§0.3). The alternative — accepting and silently dropping — is the one thing a queue
 * must never do.
 */
const QUEUE_RUNS_HERE = Platform.OS !== 'web';

export const enqueueTap = (tap: QueuedTap): Promise<boolean> =>
  !QUEUE_RUNS_HERE ? Promise.resolve(false) :
  exclusively(async () => {
    const current = await load();
    const { queue, accepted } = withTap(current, tap);
    if (accepted) await save(queue);
    return accepted;
  });

/**
 * Forget a tap that has not drained yet. `true` when there was one to forget.
 *
 * §11.3 makes deleting the only mutation an Increment permits, and a Member who logs three
 * walks underground and then removes one is doing exactly that — to a row that exists
 * nowhere but here. Without this the removal would go to a server that has never heard of
 * the id, come back with nothing deleted, be reported as a refusal, and then the drain
 * would put the row the Member just removed onto their board minutes later.
 */
export const dequeueTap = (id: string): Promise<boolean> =>
  exclusively(async () => {
    const current = await load();
    const left = current.filter((tap) => tap.id !== id);
    if (left.length === current.length) return false;
    await save(left);
    return true;
  });

/** Sign-out. The next Account on this handset inherits nothing (see `app/_layout.tsx`). */
export const clearQueue = (): Promise<void> =>
  exclusively(async () => {
    cache = [];
    publish();
    await AsyncStorage.removeItem(KEY).catch(() => undefined);
  });

export interface DrainResult {
  delivered: number;
  dropped: number;
  remaining: number;
}

/**
 * Send one tap, exactly the way `useLogIncrement` sends a live one.
 *
 * `ignoreDuplicates` is the whole idempotency story and is **not** PostgREST's default:
 * the default is `merge-duplicates`, which is an UPDATE, and there is no UPDATE grant on
 * `increments` (§11.3). A queue built on the default works against a table someone granted
 * UPDATE on and fails the first time it retries in production —
 * `supabase/tests/integration/offline_sync.test.ts` pins both halves over the wire.
 */
const send = async (tap: QueuedTap): Promise<DeliveryOutcome> => {
  try {
    const { error, status } = await supabase.from('increments').upsert(
      {
        id: tap.id,
        tile_id: tap.tileId,
        member_id: tap.memberId,
        note: tap.note,
        // §17.3's whole point. A tap held for three days happened three days ago, and
        // `useRecentIncrements` orders by this column precisely so a Member's week reads
        // in the order they lived it. `stamp_increment()` still has the last word: a
        // future value is pulled back to now(), and anything before the Board's seal is
        // refused with PT403 — which is why `occurredAtFor` clamped this past the seal
        // before it was ever queued.
        occurred_at: tap.occurredAt,
      },
      { ignoreDuplicates: true },
    );
    // The raw answer rather than a verdict, because the caller needs two things from it:
    // what became of this row, and whether the next row would be told the same. Both are
    // pure functions in `src/domain/queue.ts`; this is only the request.
    return { status, code: failure(error).code, failed: error !== null };
  } catch (thrown) {
    // supabase-js normally returns rather than throws, but a fetch that rejects before it
    // is caught — an aborted request, a DNS failure inside a polyfill — must read as "not
    // delivered", never as "drop".
    return { status: null, code: failure(thrown).code, failed: true };
  }
};

/**
 * Empty the queue, one row at a time.
 *
 * **One row at a time, and that is the point.** Batching would be one request instead of
 * n, and it would be wrong: PostgREST fails a multi-row insert as a unit, so a single row
 * the server refuses — a Tile on a Year that has frozen — takes every other row down with
 * it, and the response says nothing about which one was the problem. A device carrying
 * taps for two Families, one of them past December, would retry the live Family's taps
 * forever behind the dead one. Per-row, each verdict is about the row it belongs to.
 *
 * That is also the shape §5.1's warning needs: *RLS is checked on the proposed row before
 * `ON CONFLICT` discards it*, so once a Year freezes the drain fails on **every** queued
 * row for that Year — including taps that landed months ago and whose only remaining trace
 * is that this device never saw the response. All of them are dropped, and dropping a row
 * that had already landed costs nothing, because §17.4's idempotency means the queue never
 * knew which of its rows were already there.
 *
 * Concurrent calls are **serialised**, not collapsed — `exclusively` is a chain, and two
 * drains fired within a frame of each other both run, one after the other. That is the
 * behaviour worth having rather than an accident of the lock: a drain triggered *after* a
 * tap was enqueued has to see that tap, so folding it into a drain that started before the
 * tap existed would lose it until the next launch. The second run finds an emptier queue
 * and usually sends nothing at all, which is the cheap half of the trade.
 *
 * **Stopping is decided by `sameForEveryRow`, not by the first `keep`.** Breaking on any
 * kept row means one row the server keeps answering badly about sits at the head of the
 * queue and blocks every tap behind it, on every drain, forever. Breaking on nothing means
 * a phone in airplane mode spends a request per queued row to learn the same thing once.
 * The distinction is whether the answer was about the connection or about the row.
 */
export const drainQueue = (): Promise<DrainResult> =>
  exclusively(async () => {
    const current = await load();
    if (current.length === 0) return { delivered: 0, dropped: 0, remaining: 0 };

    const verdicts = new Map<string, Delivery>();
    let delivered = 0;
    let dropped = 0;

    for (const tap of current) {
      const outcome = await send(tap);
      const verdict = classifyDelivery(outcome);
      verdicts.set(tap.id, verdict);
      if (verdict === 'delivered') delivered += 1;
      if (verdict === 'drop') dropped += 1;
      // A dropped connection, a 5xx, a paused project: stop, keep the rest untouched, and
      // let the next trigger pick up where this left off. Carrying on would spend a
      // request per remaining row to learn the same thing. A kept row the *server* had
      // something to say about is not that, and the drain moves past it.
      if (verdict === 'keep' && sameForEveryRow(outcome)) break;
    }

    const left = afterDrain(current, verdicts);
    await save(left);
    return { delivered, dropped, remaining: left.length };
  });

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * How many taps are waiting, for the one line the sheet shows about it (`queuedCopy`).
 *
 * §1.1: offline state is `ink2` and plain words. It is stated rather than hidden because a
 * Member who logged three walks underground and sees the ring move has no other way to
 * know whether the app kept them.
 */
export const useQueuedCount = (): number => {
  useEffect(() => {
    void queuedTaps();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    // Server snapshot, for the web build. There is no disk there and no queue.
    () => 0,
  );
};

/**
 * When the queue drains, and why those moments (§17, api.md §5).
 *
 * Two triggers, and a third that is nearly free:
 *
 *   - **App launch**, gated on there being a session. Without the gate every queued row
 *     takes a 401 on a cold start before the keychain has been read, which
 *     `classifyDelivery` correctly keeps — so nothing is lost, but it is a request per row
 *     spent learning nothing. Gating it on the session means the first attempt is the one
 *     with a token on it.
 *   - **Returning to the foreground** (`AppState` → `active`). This is the moment a phone
 *     has most likely just found a network — out of the Underground, off a plane, back in
 *     range — and it is also the moment a Member is about to look at a board and see
 *     whether their week is on it.
 *   - **A tap that succeeds online**, which `useLogIncrement` calls: the network has
 *     just answered, so anything held from an earlier failure can go now rather than
 *     waiting for the next launch.
 *
 * **Deliberately not a connectivity listener.** `@react-native-community/netinfo` would
 * add a dependency to learn something the two triggers above already approximate, and it
 * approximates it badly in the case that matters: "connected to a Wi-Fi network" is not
 * "can reach Supabase", and a captive portal answers every request with a login page. The
 * drain's own classification is the real connectivity test, and it is one that cannot be
 * wrong about the thing it is testing.
 *
 * A drain that delivers or drops anything invalidates the four keys an Increment moves —
 * the counts the ladder is derived from, the sheet's Recent list, the Milestones the
 * celebration is gated on (§12.2), and the Feed. Without this the taps land server-side
 * and the screen keeps showing whatever it had, for a minute of `staleTime`, on the one
 * screen the Member opened the app to check.
 */
export const useQueueDrain = (hasSession: boolean): void => {
  // Nothing is ever enqueued on web, so there is nothing to drain and no listener worth
  // registering. See `QUEUE_RUNS_HERE`.
  const active = hasSession && QUEUE_RUNS_HERE;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!active) return;

    let live = true;
    const run = () => {
      void drainQueue().then((result) => {
        if (!live || result.delivered + result.dropped === 0) return;
        for (const key of [['tile-counts'], ['increments'], ['milestones'], ['feed']]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      });
    };

    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });

    return () => {
      live = false;
      subscription.remove();
    };
  }, [active, queryClient]);
};
