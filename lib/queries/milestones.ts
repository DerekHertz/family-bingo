/**
 * Milestones — the record that something happened, and the thing the celebration hangs
 * off (PRD §12.2, §13.2, FRONTEND_DESIGN §5).
 *
 * > **Complete** … Fires **once per Tile, ever** (§12.2) — gate on the milestone insert,
 * > not on `count >= target`, or an offline replay re-fires it.
 *
 * That sentence is why this file exists. `count >= target` is true forever once it is
 * true, so anything watching it celebrates on every render, every refetch, and every
 * replay of the queue in §17.4 — a Member reopening a finished Tile in March would be
 * congratulated again. The unique indexes in `20260801000003_play.sql` make the Milestone
 * the one fact that happens exactly once, and the server is what decides when.
 *
 * **The client never inserts one.** `milestonesToEmit()` in the domain is the *server's*
 * rule, run by a trigger; the client reads the answer. Deriving Lines from counts and
 * writing the rows here would give the same event two authors and let an offline replay
 * disagree with the database about whether a Bingo had already happened.
 */

import { useQuery } from '@tanstack/react-query';
import type { CelebratedMilestone } from '../../src/domain/celebration';
import { supabase } from '../supabase';

export interface Milestone extends CelebratedMilestone {
  createdAt: string;
}

/**
 * Scoped by Member and Year, and carrying the Account like every other key here.
 *
 * `milestones` is readable Family-wide — seeing that a sibling got their Bingo is the
 * whole point of the Feed — so an unscoped read answers with everyone's, and a Board would
 * celebrate its owner for somebody else's line. This is the `members_read` trap in a
 * different table, and the handoff warns about it twice.
 */
export const boardMilestonesKey = (memberId: string, yearId: string, accountId: string) =>
  ['milestones', 'board', memberId, yearId, accountId] as const;

/**
 * Every Milestone one Member has earned in one Year: their completed Tiles, their Lines
 * in `LINES` order, and their Blackout if they have one.
 *
 * Bounded by construction — 25 Tiles, 12 Lines, one Blackout — so unlike `useTileCounts`
 * this cannot run into PostgREST's `max_rows` and needs no paging.
 */
export function useBoardMilestones(
  memberId: string | undefined,
  yearId: string | undefined,
  accountId: string | undefined,
) {
  return useQuery({
    queryKey: boardMilestonesKey(memberId ?? 'none', yearId ?? 'none', accountId ?? 'anonymous'),
    enabled: memberId !== undefined && yearId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<Milestone[]> => {
      const { data, error } = await supabase
        .from('milestones')
        .select('id, type, tile_id, line_index, created_at')
        .eq('member_id', memberId ?? '')
        .eq('year_id', yearId ?? '')
        // Oldest first, so "the newest one" is the last element and the Milestone card can
        // take it without re-sorting a list the server already ordered.
        .order('created_at', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).map((row) => ({
        id: row.id as string,
        type: row.type as Milestone['type'],
        tileId: (row.tile_id as string | null) ?? null,
        lineIndex: (row.line_index as number | null) ?? null,
        createdAt: row.created_at as string,
      }));
    },
  });
}
