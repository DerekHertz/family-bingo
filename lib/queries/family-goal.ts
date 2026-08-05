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

export function useCompleteFamilyGoal() {
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
      // **Every** Board, not just this one. §12.3 completes the shared Centre "for every
      // Member simultaneously", so naming one Board would leave every sibling's Tile 12
      // stale for a minute of `staleTime` — on the one square whose whole point is that
      // it moves for everybody at once.
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
      // The Milestone the celebration is gated on (§12.2).
      void queryClient.invalidateQueries({ queryKey: ['milestones'] });
      // And the Feed, which gains a `tile_completed` row on every Board at once — this is
      // the loudest single thing that happens in a shared-Centre Year (§12.3, §14.2).
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
