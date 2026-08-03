/**
 * Boards, Tiles, and writing a Goal onto one (PRD §6).
 *
 * A Board is one Member's 25 Tiles for one Year (CONTEXT.md). Reads go through PostgREST
 * with the Member's own session, so RLS decides every row; the write is an RPC because a
 * Goal is reachable only through the Tile that holds it — an unattached `goals` row is
 * readable by nobody, including the person who just inserted it (see the `goals_read`
 * policy). Insert and link have to happen in one transaction or the client cannot read
 * back what it wrote.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CENTER_POSITION } from '../../src/domain/goal';
import { supabase } from '../supabase';

export interface Goal {
  id: string;
  text: string;
  target: number;
  unit: string | null;
  /** Both inferred during Sharpening (§7.10) and never typed by a Member (§6.1a). */
  unit_canonical: string | null;
  category: string | null;
  /** Display only (§6.3). Nothing in this codebase may branch on it. */
  pace_hint: string | null;
}

export interface DraftTile {
  id: string;
  position: number;
  goal: Goal | null;
  /** The Centre, once the vote has resolved to `shared` (§9.4). Not authored here. */
  familyGoalText: string | null;
}

/** One controlled Member's Board for a Year, with enough to render a row for it. */
export interface BoardSummary {
  id: string;
  memberId: string;
  memberName: string;
  isManaged: boolean;
  sealedAt: string | null;
  written: number;
}

/**
 * Keyed by Account as well as Year, and that is a privacy control rather than a cache
 * nicety — see the note on `familiesKey`. This list is "the Boards you may write on",
 * which is a different list for every Account looking at the same Year.
 */
export const myBoardsKey = (yearId: string, accountId: string) =>
  ['boards', yearId, accountId] as const;

export const boardKey = (boardId: string) => ['board', boardId] as const;
/**
 * A prefix of its own rather than `['board', id, 'head']`. Invalidation is a prefix match,
 * so nesting it under `boardKey` would mean every Goal written refetched the Year and the
 * Family too — the exact refetch this query is split out to avoid.
 */
export const boardHeadKey = (boardId: string) => ['board-head', boardId] as const;

/** Everything the drafting table's title, meta line and gates are built from. */
export interface BoardHead {
  id: string;
  sealedAt: string | null;
  memberName: string;
  /** Whether the caller is authoring as themselves or on a child's behalf (§4.2). */
  isSelf: boolean;
  year: {
    id: string;
    calendarYear: number;
    status: 'setup' | 'active' | 'frozen';
    centerMode: 'shared' | 'personal' | 'undecided';
    setupDeadline: string;
  };
  familyId: string;
  familyName: string;
  /** Deadlines resolve where the Family lives, not where the server is (§8.3 T1). */
  timezone: string;
}

/**
 * The Board's own row, its Year, and its Family — one round trip.
 *
 * Separate from `useBoard` because the two change on different clocks: the Tiles move
 * every time a Goal is written and this does not move at all during a session. Sharing a
 * key would refetch the Year and the Family on every keystroke's worth of invalidation.
 */
export function useBoardHead(boardId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: boardHeadKey(boardId ?? 'none'),
    enabled: boardId !== undefined,
    queryFn: async (): Promise<BoardHead | null> => {
      const { data, error } = await supabase
        .from('boards')
        // One string literal, not a concatenation: supabase-js infers the row type by
        // parsing this at the type level, and `'a' + 'b'` widens to `string`, which turns
        // every field access below into an error against GenericStringError.
        .select('id, sealed_at, member:member_id (display_name, account_id), year:year_id (id, calendar_year, status, center_mode, setup_deadline, family:family_id (id, name, timezone))')
        .eq('id', boardId ?? '')
        .maybeSingle();
      if (error !== null) throw error;
      if (data === null) return null;

      const member = data.member as unknown as {
        display_name: string;
        account_id: string | null;
      } | null;
      const year = data.year as unknown as {
        id: string;
        calendar_year: number;
        status: 'setup' | 'active' | 'frozen';
        center_mode: 'shared' | 'personal' | 'undecided';
        setup_deadline: string;
        family: { id: string; name: string; timezone: string } | null;
      } | null;
      if (member === null || year === null || year.family === null) return null;

      return {
        id: data.id as string,
        sealedAt: data.sealed_at as string | null,
        memberName: member.display_name,
        isSelf: member.account_id !== null && member.account_id === accountId,
        year: {
          id: year.id,
          calendarYear: year.calendar_year,
          status: year.status,
          centerMode: year.center_mode,
          setupDeadline: year.setup_deadline,
        },
        familyId: year.family.id,
        familyName: year.family.name,
        timezone: year.family.timezone,
      };
    },
  });
}

/**
 * Every Board in this Year the caller may author on: their own, plus one for each Managed
 * Member they guard (§4.2).
 *
 * The controlled-Member filter is applied here rather than left to RLS on purpose.
 * `boards_read` is Family-WIDE — it has to be, because seeing everyone's Board is the
 * whole game — so an unfiltered read returns the Boards of people whose Goals this Member
 * has no business editing. This is the same trap `members_read` sets, and it is the one
 * the handoff warns about twice.
 */
export function useMyBoards(yearId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: myBoardsKey(yearId ?? 'none', accountId ?? 'anonymous'),
    enabled: yearId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<BoardSummary[]> => {
      const { data, error } = await supabase
        .from('boards')
        .select('id, member_id, sealed_at, created_at, member:member_id (id, display_name, account_id, guardian_account_id, status), tiles (position, goal_id)')
        .eq('year_id', yearId ?? '')
        .order('created_at', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).flatMap((row) => {
        const member = row.member as unknown as {
          id: string;
          display_name: string;
          account_id: string | null;
          guardian_account_id: string | null;
          status: string;
        } | null;
        if (member === null) return [];
        // Exactly `controlled_member_ids()`, which is what write_goal() checks. Keeping
        // the two the same shape means a row that renders is a row the server will accept.
        const controlled =
          member.status === 'active' &&
          (member.account_id === accountId || member.guardian_account_id === accountId);
        if (!controlled) return [];

        const tiles = (row.tiles ?? []) as { position: number; goal_id: string | null }[];
        return [
          {
            id: row.id as string,
            memberId: member.id,
            memberName: member.display_name,
            isManaged: member.account_id === null,
            sealedAt: row.sealed_at as string | null,
            // The Centre is never authored here (§6.5), so counting it would put the
            // drafting table at "1 of 24" before a word had been written.
            written: tiles.filter(
              (t) => t.goal_id !== null && t.position !== CENTER_POSITION,
            ).length,
          },
        ];
      });
    },
  });
}

/**
 * One Board's 25 Tiles in position order, each with whatever Goal it holds.
 *
 * Position order rather than write order, because position is what the Board is: `p` is
 * row `p / 5`, column `p % 5` (§5.4). The drafting table then re-sorts into the order the
 * Goals were written, since §4.1 is explicit that order is not priority and positions are
 * dealt at seal.
 */
export function useBoard(boardId: string | undefined) {
  return useQuery({
    queryKey: boardKey(boardId ?? 'none'),
    enabled: boardId !== undefined,
    queryFn: async (): Promise<DraftTile[]> => {
      const { data, error } = await supabase
        .from('tiles')
        .select('id, position, goal:goal_id (id, text, target, unit, unit_canonical, category, pace_hint), family_goal:family_goal_id (text)')
        .eq('board_id', boardId ?? '')
        .order('position', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).map((row) => {
        const familyGoal = row.family_goal as unknown as { text: string } | null;
        return {
          id: row.id as string,
          position: row.position as number,
          goal: (row.goal as unknown as Goal | null) ?? null,
          familyGoalText: familyGoal?.text ?? null,
        };
      });
    },
  });
}

export interface GoalDraft {
  tileId: string;
  text: string;
  target: number;
  unit: string | null;
  /** Passed straight back from `sharpen` when there was one (§6.1a); never typed. */
  unitCanonical?: string | null;
  category?: string | null;
  paceHint?: string | null;
}

/**
 * §6.4 — write or rewrite a Goal while the Board is a draft.
 *
 * One RPC covers both: `write_goal()` updates in place when the Tile already holds a Goal,
 * so nothing is orphaned mid-transaction and the Tile points at one Goal throughout.
 *
 * Argument names are checked against `20260801000017_personal_center_tile.sql`, which is
 * the migration that last replaced this function. A wrong name here fails at runtime, not
 * at compile time — PostgREST reports "function not found" rather than "no such argument",
 * which reads like the RPC was never deployed.
 */
export function useWriteGoal(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: GoalDraft): Promise<Goal> => {
      const { data, error } = await supabase.rpc('write_goal', {
        tile_id: draft.tileId,
        goal_text: draft.text.trim(),
        target: draft.target,
        unit: draft.unit === null ? null : (draft.unit.trim() || null),
        unit_canonical: draft.unitCanonical ?? null,
        category: draft.category ?? null,
        pace_hint: draft.paceHint ?? null,
      });
      if (error !== null) throw error;
      return data as Goal;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
      // The count on the Family screen's Board rows moves with every write. A prefix match
      // rather than the exact key, because the Year and Account are not in scope here.
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}

/**
 * §6.4, §10.2 — empty a Tile again.
 *
 * Legitimate right up to the deadline: Tiles are filled in any order, edited freely, and
 * an unfinished Board seals with empty Tiles. `clear_goal()` deletes the Goal row with the
 * link, because a Goal has no owner but the Tile that holds it.
 */
export function useClearGoal(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tileId: string): Promise<void> => {
      const { error } = await supabase.rpc('clear_goal', { tile_id: tileId });
      if (error !== null) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}
