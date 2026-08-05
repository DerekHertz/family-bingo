/**
 * The Feed — one Family, one Year, newest first (PRD §14.1).
 *
 * Reads the `feed` view from `20260801000021_feed.sql`, which unions Increments,
 * Milestones, Swaps, resolved Votes and Members arriving (§14.2). The view is
 * `security_invoker = true`, so it carries **no policy of its own**: every row is filtered
 * by the read policy of the table it came from — `increments_family_read`,
 * `milestones_read`, `revisions_read`, `votes_read`, `members_read`.
 *
 * Every one of those is **Family-wide**, and `members_read`/`votes_read` span *every*
 * Family the caller is active in. So the `family_id` and `year_id` filters below are not
 * the security boundary — RLS is (ADR-0004) — they are what makes the answer the *right*
 * Family's Year rather than all of them interleaved. §14.1 asks for one of each and
 * nothing in the view gives you the Year for free.
 *
 * The negative half of §14's acceptance test — an Account in a different Family gets zero
 * rows — is a pgTAP test and not a UI check (§14.3), because RLS denial is zero rows and
 * never an error: a screen cannot tell the difference between "nothing happened" and
 * "nothing you may see", and only the database can be asked the question properly.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import type { FeedEvent } from '../../src/domain/feed';
import { supabase } from '../supabase';

/**
 * Rows per page. Small enough that the first screenful arrives immediately and far enough
 * under PostgREST's `max_rows = 1000` that the truncation trap in `useTileCounts` cannot
 * apply here.
 */
const PAGE = 30;

/**
 * Carries the Account, like every key in this directory. The view is filtered by the
 * caller's own policies, so the same Family and Year answer different rows for different
 * Accounts — a bare key would serve the previous Account's Feed after a sign-out, with
 * `staleTime` suppressing the refetch that would have corrected it.
 */
export const feedKey = (familyId: string, yearId: string, accountId: string) =>
  ['feed', familyId, yearId, accountId] as const;

/** Where the next page starts. A composite, and the comment on `useFeed` says why. */
interface Cursor {
  createdAt: string;
  id: string;
}

export interface FeedPage {
  events: FeedEvent[];
  next: Cursor | null;
}

const rowToEvent = (row: Record<string, unknown>): FeedEvent => ({
  id: row.id as string,
  kind: row.kind as FeedEvent['kind'],
  createdAt: row.created_at as string,
  memberId: (row.member_id as string | null) ?? null,
  position: (row.position as number | null) ?? null,
  goalText: (row.goal_text as string | null) ?? null,
  note: (row.note as string | null) ?? null,
  attachmentPath: (row.attachment_path as string | null) ?? null,
  milestoneType: (row.milestone_type as string | null) ?? null,
  lineIndex: (row.line_index as number | null) ?? null,
  beforeText: (row.before_text as string | null) ?? null,
  beforeTarget: (row.before_target as number | null) ?? null,
  afterText: (row.after_text as string | null) ?? null,
  afterTarget: (row.after_target as number | null) ?? null,
  voteKind: (row.vote_kind as string | null) ?? null,
  voteOutcome: (row.vote_outcome as string | null) ?? null,
});

/**
 * §14.1 — paginated, newest first.
 *
 * **Keyset paging on `(created_at, id)`, not `range()`.** Two reasons, and the second is
 * the one that would actually lose rows:
 *
 *   - Offset paging re-reads a moving list. A Member logs an Increment while another
 *     Member is scrolling, every later row shifts down one, and the page boundary either
 *     repeats a row or skips one.
 *   - `created_at` alone is **not unique**, and not by a little. `now()` is the
 *     *transaction's* clock, so the tap that finishes a Board writes a `tile_completed`,
 *     up to four Lines and a Blackout with the identical timestamp. A cursor of
 *     `created_at < last` would drop every one of its siblings — the loudest six rows the
 *     Feed will ever carry, gone, and silently.
 *
 * So the order is `(created_at desc, id desc)` and the cursor is both. The `id` half is a
 * tiebreaker rather than a meaning: rows from different tables can share a timestamp but
 * their random uuids give a total order, which is all paging needs.
 */
export function useFeed(
  familyId: string | undefined,
  yearId: string | undefined,
  accountId: string | undefined,
) {
  return useInfiniteQuery({
    queryKey: feedKey(familyId ?? 'none', yearId ?? 'none', accountId ?? 'anonymous'),
    enabled: familyId !== undefined && yearId !== undefined && accountId !== undefined,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      let query = supabase
        .from('feed')
        .select(
          'id, kind, created_at, member_id, position, goal_text, note, attachment_path, milestone_type, line_index, before_text, before_target, after_text, after_target, vote_kind, vote_outcome',
        )
        .eq('family_id', familyId ?? '')
        .eq('year_id', yearId ?? '')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE);

      if (pageParam !== null) {
        // "Strictly older, or the same instant and a lower id." PostgREST spells a
        // composite comparison as an `or` of a `lt` and an `and`; there is no row-value
        // syntax, and doing it in two round trips would have the same race the cursor
        // exists to avoid.
        query = query.or(
          `created_at.lt.${pageParam.createdAt},and(created_at.eq.${pageParam.createdAt},id.lt.${pageParam.id})`,
        );
      }

      const { data, error } = await query;
      if (error !== null) throw error;

      const events = (data ?? []).map((row) => rowToEvent(row as Record<string, unknown>));
      const last = events[events.length - 1];
      return {
        events,
        // A short page is the end. A full one might be, and asking again is cheaper than
        // being wrong about it.
        next:
          events.length < PAGE || last === undefined
            ? null
            : { createdAt: last.createdAt, id: last.id },
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
  });
}
