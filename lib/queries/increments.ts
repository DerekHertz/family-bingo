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
import { supabase } from '../supabase';
import { tileCountsKey } from './boards';

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
export function useLogIncrement(boardId: string, tileIds: readonly string[], accountId: string | undefined) {
  const queryClient = useQueryClient();
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
    onSuccess: (_data, tap) => {
      void queryClient.invalidateQueries({ queryKey: tileCountsKey(tileIds, accountId ?? 'anonymous') });
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
  return useMutation({
    mutationFn: async (increment: { id: string; tileId: string }): Promise<void> => {
      const { error } = await supabase.from('increments').delete().eq('id', increment.id);
      if (error !== null) throw error;
    },
    onSuccess: (_data, increment) => {
      void queryClient.invalidateQueries({ queryKey: tileCountsKey(tileIds, accountId ?? 'anonymous') });
      void queryClient.invalidateQueries({
        queryKey: recentIncrementsKey(increment.tileId, accountId ?? 'anonymous'),
      });
    },
  });
}
