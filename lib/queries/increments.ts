/**
 * Logging and unlogging an Increment (PRD §11).
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
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RECENT_INCREMENTS } from '../../src/domain/increment';
import { failedWith } from '../failure';
import { supabase } from '../supabase';
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
  /** Optional, always. Never required and never pre-focused (§11.1). */
  note?: string | null;
}

/**
 * §11.1 — one tap.
 *
 * `occurred_at` is deliberately not sent. The column defaults to `now()` at the database,
 * and `stamp_increment()` refuses anything predating the seal (§11.5) while pulling a
 * future timestamp back to now — a device with a fast clock should not lose a real tap.
 * When the offline queue arrives in slice 17 it will have to send the time it actually
 * happened; until then, the honest value is the one the server stamps.
 */
export function useLogIncrement(tileIds: readonly string[], accountId: string | undefined) {
  const queryClient = useQueryClient();
  const countsKey = tileCountsKey(tileIds, accountId ?? 'anonymous');

  return useMutation({
    mutationFn: async (tap: LogIncrement): Promise<void> => {
      const { error } = await supabase
        .from('increments')
        .upsert(
          {
            id: tap.id,
            tile_id: tap.tileId,
            member_id: tap.memberId,
            note: tap.note ?? null,
          },
          { ignoreDuplicates: true },
        );
      if (error !== null) throw error;
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
            // The server stamps the real one (§11.5). This is only what the row looks
            // like for the second before the truth arrives.
            occurredAt: new Date().toISOString(),
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

    // Reconcile either way: on success the server's `occurred_at` replaces the guess, and
    // on failure this re-reads what is actually there rather than trusting the rollback.
    onSettled: (_data, _error, tap) => {
      void queryClient.invalidateQueries({ queryKey: countsKey });
      void queryClient.invalidateQueries({
        queryKey: recentIncrementsKey(tap.tileId, accountId ?? 'anonymous'),
      });
    },
  });
}

/**
 * §11.3 — deleting is the **only** mutation an Increment permits.
 *
 * There is no edit and there will not be one: the log is append-only, and a mistake is
 * corrected by removing the row rather than rewriting history.
 */
export function useDeleteIncrement(tileIds: readonly string[], accountId: string | undefined) {
  const queryClient = useQueryClient();
  const countsKey = tileCountsKey(tileIds, accountId ?? 'anonymous');

  return useMutation({
    mutationFn: async (increment: { id: string; tileId: string }): Promise<void> => {
      // `.select()` is not decoration. `increments_own_delete` is a `using` policy, so a
      // refused DELETE matches nothing and PostgREST answers 204 with **no error object** —
      // "Remove" looked like it worked every single time, and the row came back on the
      // next refetch. Asking for the deleted rows makes an empty result the refusal it is.
      const { data, error } = await supabase
        .from('increments')
        .delete()
        .eq('id', increment.id)
        .select('id');
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
    },
  });
}
