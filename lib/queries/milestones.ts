/**
 * Milestones — the record that something happened, and the thing the celebration hangs
 * off (PRD §12.2, FRONTEND_DESIGN §5).
 *
 * > **Complete** … Fires **once per Tile, ever** (§12.2) — gate on the milestone insert,
 * > not on `count >= target`, or an offline replay re-fires it.
 *
 * That sentence is why this file exists. `count >= target` is true forever once it is
 * true, so anything watching it celebrates on every render, every refetch, and every
 * replay of the queue in §17.4 — a Member reopening a finished Tile in March would be
 * congratulated again. `one_tile_completed_per_tile` makes the Milestone the one fact
 * that happens exactly once, and the server is what decides when.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

export const tileMilestonesKey = (boardId: string, accountId: string) =>
  ['milestones', 'tiles', boardId, accountId] as const;

/**
 * The Tiles on this Board that have a `tile_completed` Milestone, as a set of Tile ids.
 *
 * Carries the Account like every other key here: `milestones` is readable Family-wide, so
 * these rows are not the same for every caller.
 */
export function useTileMilestones(
  boardId: string | undefined,
  tileIds: readonly string[],
  accountId: string | undefined,
) {
  return useQuery({
    queryKey: tileMilestonesKey(boardId ?? 'none', accountId ?? 'anonymous'),
    enabled: boardId !== undefined && accountId !== undefined && tileIds.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('milestones')
        .select('tile_id')
        .eq('type', 'tile_completed')
        .in('tile_id', [...tileIds]);
      if (error !== null) throw error;
      return new Set((data ?? []).flatMap((row) => {
        const id = row.tile_id as string | null;
        return id === null ? [] : [id];
      }));
    },
  });
}
