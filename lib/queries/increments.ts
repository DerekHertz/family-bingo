/**
 * Logging and unlogging an Increment (PRD §11, §16, §17).
 *
 * There is no RPC here on purpose. An Increment is a plain insert with a **client-generated
 * primary key** (§11.2), and that is the whole idempotency story: the offline queue of
 * §17.4 replays the same rows and the database keeps one of each. Wrapping it in a function
 * would put a second definition of "the same tap" in the way of that.
 *
 * `resolution=ignore-duplicates` is load-bearing and is not the default. PostgREST resolves
 * an upsert with `merge-duplicates`, which is an UPDATE — and there is no UPDATE grant on
 * `increments`, nor will there be: §11.3 makes the log append-only and deleting is the only
 * mutation permitted. A queue built on the default works in development, against a table
 * someone granted UPDATE on, and fails the first time it retries in production.
 * `supabase/tests/integration/offline_sync.test.ts` pins this over the wire.
 *
 * Two things arrived here in slices 16 and 17 and both hang off the same tap:
 *
 *   - **A photo** (§16), which is optional, always (§11.1) and is written *after* the
 *     Increment because `attachments.increment_id` is a foreign key. See
 *     `lib/queries/attachments.ts` for the order and its compensation.
 *   - **The queue** (§17). A tap that the network did not take is held on the device and
 *     replayed later, and — this is the part that decides the shape of the mutation — a
 *     held tap is **not** a failure. The optimistic patch stands, nothing rolls back, and
 *     nothing is invalidated, because invalidating would refetch a server that does not
 *     have the row yet and take the Member's progress back off the screen.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  photoFailedCopy,
  photoUnavailableCopy,
} from '../../src/domain/attachment';
import { RECENT_INCREMENTS } from '../../src/domain/increment';
import { classifyDelivery } from '../../src/domain/queue';
import { failedWith, failure } from '../failure';
import type { PickedPhoto } from '../photo';
import { dequeueTap, drainQueue, enqueueTap } from '../queue';
import { supabase } from '../supabase';
import { attachPhoto } from './attachments';
import { tileCountsKey } from './boards';

/** A write the server would not take, and that a retry will not fix. */
export class IncrementRefused extends Error {
  constructor(readonly action: 'log' | 'delete') {
    super(`the server refused to ${action} this increment`);
    this.name = 'IncrementRefused';
  }
}

/**
 * What to tell somebody whose tap did not land.
 *
 * Matched on `code` rather than message text, because the SQLSTATE is the only part that
 * is stable — `PT403` and `42501` never appear in the sentence, so every `/PT403/` tested
 * against a message has always been a no-op. §0.3: never ask for a retry that is
 * guaranteed to fail.
 */
export const incrementFailureCopy = (thrown: unknown): string => {
  // `stamp_increment()` — an Increment that predates the seal (§11.5).
  if (failedWith(thrown, 'PT403')) return 'That one can’t be logged against this board.';
  // RLS: `increments_own_insert` is a `with check`, and a frozen Year or somebody else's
  // Board both land here.
  if (failedWith(thrown, '42501')) return 'This board isn’t taking progress right now.';
  if (thrown instanceof IncrementRefused) {
    return thrown.action === 'delete'
      ? 'That one couldn’t be removed. It may already be gone.'
      : 'That one didn’t save.';
  }
  return 'That didn’t save. Have another go in a moment.';
};

export interface Increment {
  id: string;
  tileId: string;
  note: string | null;
  occurredAt: string;
}

/**
 * Carries the Account for the same reason every other key here does: `increments_family_read`
 * filters on `visible_member_ids()`, so these rows are not the same for every caller.
 */
export const recentIncrementsKey = (tileId: string, accountId: string) =>
  ['increments', tileId, accountId] as const;

/** §3's "Recent" — the last three, newest first, with their notes. */
export function useRecentIncrements(tileId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: recentIncrementsKey(tileId ?? 'none', accountId ?? 'anonymous'),
    enabled: tileId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<Increment[]> => {
      const { data, error } = await supabase
        .from('increments')
        .select('id, tile_id, note, occurred_at')
        .eq('tile_id', tileId ?? '')
        // By `occurred_at`, not `created_at`: they come apart legitimately, because the
        // offline queue holds taps across restarts and replays them days later (§17.3).
        // A list ordered by arrival would show a Member their week out of order.
        .order('occurred_at', { ascending: false })
        .limit(RECENT_INCREMENTS);
      if (error !== null) throw error;

      return (data ?? []).map((row) => ({
        id: row.id as string,
        tileId: row.tile_id as string,
        note: (row.note as string | null) ?? null,
        occurredAt: row.occurred_at as string,
      }));
    },
  });
}

export interface LogIncrement {
  /**
   * Minted on the device, before the request (§11.2). The caller generates it so a retry
   * of a tap whose response was lost carries the *same* id and lands once.
   */
  id: string;
  tileId: string;
  memberId: string;
  /**
   * The Family the Tile belongs to — not written to `increments`, but the first segment
   * of an Attachment's object key (§16.2), and the only reason this is on the tap.
   */
  familyId: string;
  /** Optional, always. Never required and never pre-focused (§11.1). */
  note?: string | null;
  /**
   * When the Member says it happened, minted on the device at the moment of the tap.
   *
   * Sent, as of slice 17. It used to be left to the column default, and the comment here
   * said the queue would have to send it: a tap held for three days and replayed on
   * Thursday happened on Monday, and `useRecentIncrements` orders by `occurred_at`
   * precisely so a Member's week reads in the order they lived it rather than the order
   * the network recovered. `stamp_increment()` still has the last word — a future value
   * is pulled back to `now()`, and anything before the Board's seal is refused with
   * `PT403` (§11.5, no backdating).
   */
  occurredAt: string;
  /** §16.1 — one optional photo. Uploaded after the Increment lands, never before. */
  photo?: PickedPhoto | null;
}

/** What happened to the photo that was attached to the tap, if there was one. */
export type PhotoOutcome = 'none' | 'attached' | 'skipped' | 'failed';

export interface LogResult {
  /** False when the tap is on the device rather than on the server (§17.3). */
  delivered: boolean;
  photo: PhotoOutcome;
}

/**
 * The sentence for a tap that landed but whose photo did not — or `null` when there is
 * nothing to say, which is the common case.
 *
 * §1.1: failed uploads and offline state get `ink2` and plain words, never colour. The
 * Member must never be told a photo saved when it did not, and must never be told the tap
 * failed when it did not — §11.1 makes the photo the optional half, and the sentence has
 * to say so in that order.
 */
export const photoOutcomeCopy = (result: LogResult | undefined): string | null => {
  if (result === undefined) return null;
  if (result.photo === 'skipped') return photoUnavailableCopy;
  if (result.photo === 'failed') return photoFailedCopy;
  return null;
};

/** The four keys one Increment moves. Kept in one place so a drain and a tap agree. */
const reconcile = (client: QueryClient, countsKey: readonly unknown[], recentKey: readonly unknown[]) => {
  void client.invalidateQueries({ queryKey: countsKey });
  void client.invalidateQueries({ queryKey: recentKey });
  // **The Milestone, which is what the celebration is gated on (§12.2, §5).**
  //
  // Without this the gate is built and never fed: the tap that completes a Tile writes
  // the Milestone server-side, the client keeps its pre-write set for a minute of
  // `staleTime`, and the celebration the whole slice exists for simply never happens.
  // Nothing else in the app invalidates this key.
  void client.invalidateQueries({ queryKey: ['milestones'] });
  // And the Feed, which every Increment adds a row to (§14.2). With a minute of
  // `staleTime` and no invalidation, the common path — log a tap, go Back, open "What's
  // happened" — showed a Feed with the tap missing from it. On a tap that closed a Tile it
  // hid the loudest six rows the Feed will ever carry.
  void client.invalidateQueries({ queryKey: ['feed'] });
};

/**
 * §11.1 — one tap.
 *
 * Three outcomes now, not two, and telling them apart is §17's whole client half:
 *
 *   - **Delivered.** The row is on the server; reconcile, and attach the photo if there
 *     is one.
 *   - **Held** (`classifyDelivery` → `keep`). A network error or a 5xx: the tap goes into
 *     the queue and this resolves *successfully*, because the tap is not lost and the
 *     optimistic patch of §17.2 must stay exactly where it is.
 *   - **Refused** (`classifyDelivery` → `drop`). A frozen Year, a Board that is not the
 *     caller's, an Increment predating the seal. This throws, the optimistic patch rolls
 *     back, and `incrementFailureCopy` says which. Queueing one of these would retry it
 *     on every launch for a Year that does not unfreeze (api.md §5.1).
 */
export function useLogIncrement(tileIds: readonly string[], accountId: string | undefined) {
  const queryClient = useQueryClient();
  const countsKey = tileCountsKey(tileIds, accountId ?? 'anonymous');

  return useMutation({
    mutationFn: async (tap: LogIncrement): Promise<LogResult> => {
      const { error, status } = await supabase.from('increments').upsert(
        {
          id: tap.id,
          tile_id: tap.tileId,
          member_id: tap.memberId,
          note: tap.note ?? null,
          occurred_at: tap.occurredAt,
        },
        { ignoreDuplicates: true },
      );

      // `failed` matters as much as the status: postgrest-js sets `error` on an *ok*
      // response whose body it could not parse — a captive portal, a TLS-inspecting proxy
      // — and without it that reads as a landing and the tap is neither queued nor sent.
      const verdict = classifyDelivery({
        status,
        code: failure(error).code,
        failed: error !== null,
      });

      if (verdict === 'drop') throw error ?? new IncrementRefused('log');

      if (verdict === 'keep') {
        const accepted = await enqueueTap({
          id: tap.id,
          tileId: tap.tileId,
          memberId: tap.memberId,
          note: tap.note ?? null,
          occurredAt: tap.occurredAt,
          attempts: 0,
        });
        // Refused at the cap, which means the queue is the thing that is broken. Throwing
        // rolls the ring back, which is the honest answer: this tap is not saved anywhere.
        if (!accepted) throw new IncrementRefused('log');
        // **The photo is not queued, and §17.1 is why**: "Offline queue covers Increments
        // only. Authoring, voting, and invites remain online-only. Deliberately narrow."
        // An upload has none of the properties that make an Increment safe to replay — it
        // is bytes rather than a row, it has no client-minted key the server dedupes on,
        // and an object uploaded for an Increment that is later dropped becomes an orphan
        // no reaper knows about (see `attachPhoto`). So the tap and the note survive, the
        // photo does not, and `photoUnavailableCopy` says exactly that rather than letting
        // a Member believe a picture of their child is saved when it is on nobody's disk.
        return { delivered: false, photo: tap.photo == null ? 'none' : 'skipped' };
      }

      if (tap.photo == null) return { delivered: true, photo: 'none' };

      try {
        await attachPhoto({
          familyId: tap.familyId,
          incrementId: tap.id,
          photo: tap.photo,
        });
        return { delivered: true, photo: 'attached' };
      } catch {
        // The Increment stands. §11.1 makes the photo the optional half of a tap, so a
        // failed upload must not take the tap down with it — and the Member is told,
        // because the alternative is believing a photo saved when it did not.
        return { delivered: true, photo: 'failed' };
      }
    },

    /**
     * §3: "One tap, **optimistic**, haptic on touch-down", and §17.2 says the same thing
     * again — "progress updates immediately on tap". The ring has to move under the finger.
     * Waiting for the round trip is what makes a tap feel lost, and it is the reason a
     * Member taps a second time and logs two.
     *
     * The count and the Recent list are both patched, because the sheet shows both and a
     * ring that moved above a list that did not is worse than neither moving.
     */
    onMutate: async (tap) => {
      const recentKey = recentIncrementsKey(tap.tileId, accountId ?? 'anonymous');
      // Any refetch already in flight would land after this and undo it.
      await queryClient.cancelQueries({ queryKey: countsKey });
      await queryClient.cancelQueries({ queryKey: recentKey });

      const counts = queryClient.getQueryData<Record<string, number>>(countsKey);
      const recent = queryClient.getQueryData<Increment[]>(recentKey);

      queryClient.setQueryData<Record<string, number>>(countsKey, (current) => ({
        ...(current ?? {}),
        [tap.tileId]: (current?.[tap.tileId] ?? 0) + 1,
      }));
      queryClient.setQueryData<Increment[]>(recentKey, (current) =>
        [
          {
            id: tap.id,
            tileId: tap.tileId,
            note: tap.note ?? null,
            // The same value that was sent, rather than a second `new Date()` — a tap
            // held in the queue for three days is replayed with this timestamp (§17.3),
            // and the optimistic row has to be the row that eventually lands or the
            // sheet's list reorders itself the moment the drain succeeds.
            occurredAt: tap.occurredAt,
          },
          ...(current ?? []),
        ].slice(0, RECENT_INCREMENTS),
      );

      return { counts, recent, recentKey };
    },

    /**
     * Put back exactly what was there. §11.5 and `tile_is_loggable()` refuse real taps —
     * a frozen Year, an empty Tile, the shared Centre — and a refusal that left the ring
     * one ahead would have the Member believe a tap landed that never did.
     */
    onError: (_error, _tap, context) => {
      if (context === undefined) return;
      queryClient.setQueryData(countsKey, context.counts);
      queryClient.setQueryData(context.recentKey, context.recent);
    },

    /**
     * The tap is on the server and the network just proved it works, so anything held
     * from an earlier failure can go now rather than waiting for the next launch or
     * foreground (`useQueueDrain` owns the other two triggers).
     */
    onSuccess: (result, tap) => {
      if (!result.delivered) return;
      void drainQueue().then((drained) => {
        if (drained.delivered + drained.dropped === 0) return;
        reconcile(
          queryClient,
          countsKey,
          recentIncrementsKey(tap.tileId, accountId ?? 'anonymous'),
        );
      });
    },

    /**
     * Reconcile on a landing and on a refusal — but **never on a tap that was queued**.
     *
     * This is the join between §17.2's optimistic UI and §17.3's queue, and getting it
     * wrong is invisible in development, where there is always a network. An invalidation
     * refetches; a refetch offline either fails or, worse, succeeds against a server that
     * does not have the row yet; and either way the ring the Member just watched move goes
     * back down. The optimistic patch *is* the record of a queued tap until the drain
     * lands, so nothing is allowed to overwrite it.
     *
     * On a refusal this still re-reads rather than trusting the rollback, and on a landing
     * it replaces the guessed row with the server's.
     */
    onSettled: (data, error, tap) => {
      if (error === null && data?.delivered === false) return;
      reconcile(
        queryClient,
        countsKey,
        recentIncrementsKey(tap.tileId, accountId ?? 'anonymous'),
      );
    },
  });
}

/**
 * §11.3 — deleting is the **only** mutation an Increment permits.
 *
 * There is no edit and there will not be one: the log is append-only, and a mistake is
 * corrected by removing the row rather than rewriting history.
 *
 * §16.6 needs nothing here. Deleting an Increment cascades to its `attachments` row, the
 * `attachments_orphan_object` trigger records the owed removal in the same commit, and
 * `reap-attachments` takes the bytes out through the Storage API — which is the only way
 * they *can* go, since `storage.protect_delete()` refuses even a superuser. A client-side
 * `remove()` here would be a second deleter racing a trigger it cannot see.
 */
export function useDeleteIncrement(tileIds: readonly string[], accountId: string | undefined) {
  const queryClient = useQueryClient();
  const countsKey = tileCountsKey(tileIds, accountId ?? 'anonymous');

  return useMutation({
    mutationFn: async (increment: { id: string; tileId: string }): Promise<void> => {
      /**
       * A tap that has not drained yet exists **only on this device** (§17.3), and the
       * way to delete it is to forget it. Without this, removing a walk logged
       * underground sends a DELETE for an id the server has never seen, gets nothing
       * back, reports a refusal — and then the drain puts the row the Member just removed
       * onto their board a few minutes later.
       *
       * The server delete is still attempted afterwards rather than skipped, because a
       * queued tap may also have landed: `classifyDelivery` keeps a row whose response
       * was lost, so "in the queue" and "on the server" are not exclusive.
       */
      const wasQueued = await dequeueTap(increment.id);

      // `.select()` is not decoration. `increments_own_delete` is a `using` policy, so a
      // refused DELETE matches nothing and PostgREST answers 204 with **no error object** —
      // "Remove" looked like it worked every single time, and the row came back on the
      // next refetch. Asking for the deleted rows makes an empty result the refusal it is.
      const { data, error } = await supabase
        .from('increments')
        .delete()
        .eq('id', increment.id)
        .select('id');

      // Once the tap has been taken out of the queue it is gone whatever the server says:
      // a network error here means the row was never there to delete, and an empty result
      // means the same. Reporting either as a refusal would tell a Member their removal
      // failed when it is the only removal there was to make.
      if (wasQueued) return;

      if (error !== null) throw error;
      if ((data ?? []).length === 0) throw new IncrementRefused('delete');
    },

    // Optimistic for the same reason logging is: removing a tap you did not mean to make
    // is housekeeping, and housekeeping that stalls reads as a refusal.
    onMutate: async (increment) => {
      const recentKey = recentIncrementsKey(increment.tileId, accountId ?? 'anonymous');
      await queryClient.cancelQueries({ queryKey: countsKey });
      await queryClient.cancelQueries({ queryKey: recentKey });

      const counts = queryClient.getQueryData<Record<string, number>>(countsKey);
      const recent = queryClient.getQueryData<Increment[]>(recentKey);

      queryClient.setQueryData<Record<string, number>>(countsKey, (current) => ({
        ...(current ?? {}),
        // Never below zero: the cache is a guess and a negative count would render as a
        // dormant Tile on a Goal with progress on it.
        [increment.tileId]: Math.max(0, (current?.[increment.tileId] ?? 0) - 1),
      }));
      queryClient.setQueryData<Increment[]>(recentKey, (current) =>
        (current ?? []).filter((row) => row.id !== increment.id),
      );

      return { counts, recent, recentKey };
    },

    onError: (_error, _increment, context) => {
      if (context === undefined) return;
      queryClient.setQueryData(countsKey, context.counts);
      queryClient.setQueryData(context.recentKey, context.recent);
    },

    // The removed row leaves a hole in a list of three, and only the server knows what
    // fills it — so this refetch is a correction, not a formality.
    onSettled: (_data, _error, increment) => {
      void queryClient.invalidateQueries({ queryKey: countsKey });
      void queryClient.invalidateQueries({
        queryKey: recentIncrementsKey(increment.tileId, accountId ?? 'anonymous'),
      });
      // A deleted Increment can drop a Tile back below its Target. The Milestone stays —
      // it was pushed and cannot be unsent (§15.3) — but the client should be reading the
      // server's answer rather than its own guess about it.
      void queryClient.invalidateQueries({ queryKey: ['milestones'] });
      // The Feed loses the row (§11.3 makes deleting the only mutation an Increment
      // permits, and the Feed reads `increments` directly).
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
