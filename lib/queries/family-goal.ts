/**
 * Marking the Family Goal done (PRD §12.3, FRONTEND_DESIGN §4.3).
 *
 * > The Family Goal (shared Center Tile) completes **for every Member simultaneously**
 * > when marked done. Any Member may mark it; the Feed records who did.
 *
 * The one square nobody counts up to. A Family Goal has no Target — `tile_is_loggable()`
 * refuses Increments on the shared Centre — so this is the only way it ever completes, and
 * it completes on every Board in the Year at once because every Board's Tile 12 points at
 * the same `family_goals` row (§9.4).
 *
 * Argument names checked against `20260801000019_complete_tile.sql`. `member_id` is passed
 * rather than inferred, the same shape as `cast_ballot()`: a Guardian marking it as their
 * Managed Member is the normal case, and the act is attributed to the Managed Member
 * rather than to the Guardian (§4.2).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { failedWith } from '../failure';
import { supabase } from '../supabase';
import { boardKey } from './boards';

/**
 * Why marking it done was refused, phrased for a Member.
 *
 * Matched on SQLSTATE rather than message text, because `PT403` never appears in the
 * sentence — the trap the handoff records, and the reason four screens once answered every
 * failure with "have another go in a moment".
 */
export const familyGoalFailureCopy = (thrown: unknown): string => {
  // The Year has not sealed, or has no Family Goal at all.
  if (failedWith(thrown, 'PT403')) return 'This one isn’t ready to be marked done yet.';
  // A frozen Year, a Member the caller does not control, or the wrong Family.
  if (failedWith(thrown, '42501')) return 'You can’t mark this one done.';
  return 'That didn’t save. Have another go in a moment.';
};

export function useCompleteFamilyGoal(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { yearId: string; memberId: string }): Promise<void> => {
      const { error } = await supabase.rpc('complete_family_goal', {
        year_id: input.yearId,
        member_id: input.memberId,
      });
      if (error !== null) throw error;
    },
    onSuccess: () => {
      // The Centre's state lives on the Tiles read, not on the counts — `completed_at` is
      // what makes it complete, and no Increment will ever appear for it.
      // Prefix match, so it clears the Board for whichever Account is holding it.
      void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      // Every Board in the Year now shows it complete (§12.3), including the ones this
      // screen is not looking at.
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}
