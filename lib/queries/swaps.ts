/**
 * Swaps — a Member's three permitted changes to a Sealed Board (PRD §18).
 *
 * An RPC rather than an update, and the reason is the same one `write_goal()` has: a Goal
 * is reachable only through the Tile that holds it, so replacing one means writing a row
 * and re-pointing a Tile in a single transaction. But `swap_tile()` also does three things
 * no client could:
 *
 *   - It **decides whether the edit costs a swap** (§18.2, §18.3). Raising a Target is
 *     free; lowering it or rewriting the text is not. `src/domain/swaps.ts` is the tested
 *     TS twin of that rule and is what the UI previews with — the server is what decides.
 *   - It writes the **Revision**, and the trigger on that is what decrements the budget.
 *     There is no `update` grant on `boards`, so the counter cannot be moved any other
 *     way: writing the record *is* spending the budget (§18.4).
 *   - It can **complete a Tile**. Lowering a Target to at or below existing progress
 *     finishes the square, and `swap_tile()` calls `record_tile_completion()` and
 *     `record_line_milestones()` itself — so a Swap can produce a Tile completion, a Line
 *     and a Bingo with no Increment involved. Anything cached about Milestones is stale
 *     the moment this returns.
 *
 * **The argument is `goal_text`, not `text`.** `docs/api.md` §2.1 and §8 both say `text`
 * and both are wrong; the migration declares `goal_text`, matching `write_goal`. PostgREST
 * resolves by argument name, so the wrong one answers PGRST202 — "could not find the
 * function" — which reads exactly like a migration that was never deployed.
 * `lib/rpc-signatures.test.ts` checks this call site against the migration.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SWAP_BUDGET } from '../../src/domain/swaps';
import { failedWith } from '../failure';
import { supabase } from '../supabase';
import { boardPrefix, type Goal } from './boards';

/**
 * What to tell somebody whose swap was refused.
 *
 * Thin on purpose. `swap_tile()` raises `PT403` for four different reasons — a draft
 * Board, the shared Centre, a completed Tile, an exhausted budget — and one SQLSTATE
 * cannot tell them apart. The client knows all four before it asks, so the discrimination
 * lives in `swapRefusalCopy()` and the button is never offered for a swap the server would
 * refuse. What is left here is the case where the two disagreed, which means the Member's
 * view of the Board is stale rather than that they did something wrong.
 */
export const swapFailureCopy = (thrown: unknown): string => {
  if (failedWith(thrown, '22023')) {
    return 'A goal needs some words, and a target of at least one.';
  }
  // The two the client cannot pre-empt: somebody else's Board, or a Year that froze
  // between the sheet opening and the tap.
  if (failedWith(thrown, '42501')) return 'This board isn’t taking changes right now.';
  if (failedWith(thrown, 'PT403')) {
    return 'That square can’t be swapped any more. Close this and take another look.';
  }
  return 'That didn’t save. Have another go in a moment.';
};

/**
 * How many Swaps a Board has left.
 *
 * Read from `boards.swaps_used` rather than counted from `revisions`, because a raised
 * Target writes no Revision and costs nothing (§18.3) — counting rows would charge for it.
 * The column is the server's own answer and the `swap_budget` check constraint keeps it
 * between 0 and 3.
 *
 * Its own query rather than a field on `useBoardHead`, because the two move on different
 * clocks: the head does not change during a session and this changes every time a Swap
 * lands. Sharing a key would refetch the Year and the Family with it.
 */
export const swapBudgetKey = (boardId: string, accountId: string) =>
  ['swap-budget', boardId, accountId] as const;

export function useSwapBudget(boardId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: swapBudgetKey(boardId ?? 'none', accountId ?? 'anonymous'),
    // Carries the Account like every key here: `boards_read` is Family-wide, so the same
    // Board id is answerable for one caller and empty for another.
    enabled: boardId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('boards')
        .select('swaps_used')
        .eq('id', boardId ?? '')
        .maybeSingle();
      if (error !== null) throw error;
      // A Board the caller cannot read answers `null`. Reporting a full budget there would
      // offer three swaps on somebody else's Board; reporting none is the honest floor.
      return data === null ? SWAP_BUDGET : (data.swaps_used as number);
    },
  });
}

export interface SwapDraft {
  tileId: string;
  text: string;
  target: number;
}

/**
 * §18.2 — replace a Goal's text, or lower its Target. Both cost a Swap; raising a Target
 * is free and the server decides which happened.
 */
export function useSwapTile(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: SwapDraft): Promise<Goal> => {
      const { data, error } = await supabase.rpc('swap_tile', {
        tile_id: draft.tileId,
        goal_text: draft.text.trim(),
        target: draft.target,
      });
      if (error !== null) throw error;
      return data as Goal;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardPrefix(boardId) });
      void queryClient.invalidateQueries({ queryKey: ['swap-budget', boardId] });
      // A lowered Target can finish the square on the spot, and `swap_tile()` records the
      // Tile completion and any Lines it closes inside the same transaction. Without this
      // the board keeps a minute of `staleTime`'s worth of a Milestone set that no longer
      // matches the Tiles above it — and the celebration never fires for a Bingo the
      // server has already recorded.
      void queryClient.invalidateQueries({ queryKey: ['milestones'] });
      // The Feed gains a `swap` row, and a `tile_completed` if the Target landed low
      // enough. Both are somebody else's news as much as this Member's (§18.4).
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      // The Family screen's row for this Board.
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}
