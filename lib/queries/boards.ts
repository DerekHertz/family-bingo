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
import { isControlledBy, isManaged } from '../../src/domain/member';
import type { ReadinessBoard } from '../../src/domain/ready';
import { failure } from '../failure';
import { supabase } from '../supabase';

/**
 * Why `write_goal()` would not take this Goal, phrased for the Member who wrote it.
 *
 * Here rather than on `app/board/goal.tsx`, for the reason `incrementFailureCopy` is in
 * `increments.ts`: the module that owns the RPC owns the sentence for its refusals, so
 * the copy and the argument names are checked against the same migration by the same
 * reader. Migration 17 (`personal_center_tile`) is the one that last replaced the function
 * and holds every `raise` below.
 *
 * Read through `failure()` rather than `instanceof Error`, because a PostgREST rejection
 * is a plain object and the whole chain read `''` before that existed (see lib/failure.ts).
 *
 * **Known defect, carried over unchanged: the centre branch cannot fire.** `write_goal()`
 * raises PT403 twice — 'this Board is sealed' and 'the Center Tile is decided by the
 * Family, not authored' — and the first branch below claims every PT403, so a Member who
 * somehow reaches the Centre while the mode is `shared` is told their board has sealed.
 * The order is preserved deliberately rather than quietly corrected: it is a copy
 * decision (§0.3) and the two sentences say different things about what to do next.
 * Fixing it means testing the message before the code, or the migration raising a
 * distinguishable SQLSTATE.
 */
export const writeGoalFailureCopy = (thrown: unknown): string => {
  const { message: raw, code } = failure(thrown);
  if (code === 'PT403' || /sealed/i.test(raw)) {
    return 'This board has sealed. Changing a goal now costs a swap.';
  }
  if (/Center Tile|centre/i.test(raw)) {
    return 'The centre square is the family’s, not yours to write.';
  }
  // Both 42501: `controlled_member_ids()` said no, or the Year is frozen.
  if (/not your Board/i.test(raw)) return 'That board isn’t yours to write on.';
  if (/frozen/i.test(raw)) return 'This year has finished.';
  return 'That didn’t save. Have another go in a moment.';
};

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
  /** Set once when Sharpening produced this Goal — the Goal's one sharpen (§4.2). */
  sharpened_at: string | null;
}

export interface DraftTile {
  id: string;
  position: number;
  goal: Goal | null;
  /** The Centre, once the vote has resolved to `shared` (§9.4). Not authored here. */
  familyGoalText: string | null;
  /**
   * When the Family marked the shared Goal done (§12.3) — the Centre's *only* completion
   * signal, and the reason this field has to exist.
   *
   * A Family Goal has no Target and takes no Increments: `tile_is_loggable()` refuses them
   * on the shared Centre, because it "is marked done by any Member and completes for
   * everyone at once". So counting Increments on that Tile answers 0 forever, and a
   * completed Family Goal would render dormant, sit outside `completedLines()`, and make
   * the four Lines through the Centre — and therefore Blackout (§13.3) — unreachable.
   */
  familyGoalCompletedAt: string | null;
}

/** One controlled Member's Board for a Year, with enough to render a row for it. */
export interface BoardSummary {
  id: string;
  memberId: string;
  memberName: string;
  isManaged: boolean;
  sealedAt: string | null;
  /** §22 — when this Member said the Board was done, or null while they are still writing. */
  readyAt: string | null;
  written: number;
  /**
   * §21.4's marker, on the row as well as on the Board itself.
   *
   * A Guardian looking at the Family screen in September sees "3 of 24" against a child
   * who was approved in July, and without this there is nothing on that row to say why.
   * The Board screen explains itself once opened; this is the same fact one level up.
   */
  joinedLateAt: string | null;
}

/**
 * Keyed by Account as well as Year, and that is a privacy control rather than a cache
 * nicety — see the note on `familiesKey`. This list is "the Boards you may write on",
 * which is a different list for every Account looking at the same Year.
 */
export const myBoardsKey = (yearId: string, accountId: string) =>
  ['boards', yearId, accountId] as const;

/**
 * Carries the Account for the same two reasons every other key here does.
 *
 * `tiles_read` is Family-wide, so these rows are not the same for every caller — and the
 * query cannot run at all before a session exists. A bare key meant a cold deep link
 * straight to `/board/[id]`, which is exactly what a magic link is, fired the Tiles read
 * with no token, took a 401, and then never refetched: the key never changed when the
 * session arrived, so the screen sat on a spinner until it was reopened by hand.
 */
export const boardKey = (boardId: string, accountId: string) =>
  ['board', boardId, accountId] as const;

/**
 * The prefix every Account's copy of a Board shares.
 *
 * Invalidation is a prefix match, and a Board changing is a fact about the Board rather
 * than about whoever is holding it — so writes clear all of them rather than guessing
 * which Account's key to name.
 */
export const boardPrefix = (boardId: string) => ['board', boardId] as const;
/**
 * A prefix of its own rather than `['board', id, 'head']`. Invalidation is a prefix match,
 * so nesting it under `boardKey` would mean every Goal written refetched the Year and the
 * Family too — the exact refetch this query is split out to avoid.
 *
 * Carries the Account because two of the fields it caches — `isSelf` and `controlled` —
 * are answers about the caller, not about the Board. Without it, a Board fetched while
 * the session was still loading cached "not yours" for a minute of `staleTime`.
 */
export const boardHeadKey = (boardId: string, accountId: string) =>
  ['board-head', boardId, accountId] as const;

/** Everything the drafting table's title, meta line and gates are built from. */
export interface BoardHead {
  id: string;
  sealedAt: string | null;
  /** Whose Board this is. Sharpening is attributed and rate-limited per Member (§7.8). */
  memberId: string;
  memberName: string;
  /** Whether the caller is authoring as themselves or on a child's behalf (§4.2). */
  isSelf: boolean;
  /**
   * Whether the caller may write here at all — `controlled_member_ids()`, client-side.
   *
   * `boards_read` is Family-wide, so this screen opens for any Member's Board. Without
   * this the drafting table offers a sibling's Board full write affordances and
   * `write_goal()` answers 42501. `isSelf` cannot stand in for it: a Managed Member's
   * Board is legitimately controlled and legitimately not the caller's own.
   */
  controlled: boolean;
  /** §22 — when this Member said the Board was done. Null while they are still writing. */
  readyAt: string | null;
  /** §21.1 — set on a Board dealt to a Member approved mid-Year. */
  joinedLateAt: string | null;
  /** §21.1 — that Member's own 7-day window, which is not the Year's. */
  personalSetupDeadline: string | null;
  year: {
    id: string;
    calendarYear: number;
    status: 'setup' | 'active' | 'frozen';
    centerMode: 'shared' | 'personal' | 'undecided';
    setupDeadline: string;
    /**
     * When the Year begins (§22.5). A Board can now seal before this — that is the whole
     * point of Ready — so the screen has to ask both "has it sealed" and "has it started"
     * rather than treating the first as the second.
     */
    playOpensAt: string;
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
    queryKey: boardHeadKey(boardId ?? 'none', accountId ?? 'anonymous'),
    // Waits for the Account as well as the Board. `useSession()` is `undefined` on its
    // first render, so firing before it resolves cached `controlled: false` against a key
    // the real Account would then reuse — a read-only drafting table on the Member's own
    // Board, for a minute of `staleTime`, with no refetch to correct it.
    enabled: boardId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<BoardHead | null> => {
      const { data, error } = await supabase
        .from('boards')
        // One string literal, not a concatenation: supabase-js infers the row type by
        // parsing this at the type level, and `'a' + 'b'` widens to `string`, which turns
        // every field access below into an error against GenericStringError.
        .select('id, sealed_at, ready_at, joined_late_at, personal_setup_deadline, member_id, member:member_id (display_name, account_id, guardian_account_id, status), year:year_id (id, calendar_year, status, center_mode, setup_deadline, play_opens_at, family:family_id (id, name, timezone))')
        .eq('id', boardId ?? '')
        .maybeSingle();
      if (error !== null) throw error;
      if (data === null) return null;

      const member = data.member as unknown as {
        display_name: string;
        account_id: string | null;
        guardian_account_id: string | null;
        status: string;
      } | null;
      const year = data.year as unknown as {
        id: string;
        calendar_year: number;
        status: 'setup' | 'active' | 'frozen';
        center_mode: 'shared' | 'personal' | 'undecided';
        setup_deadline: string;
        play_opens_at: string;
        family: { id: string; name: string; timezone: string } | null;
      } | null;
      if (member === null || year === null || year.family === null) return null;

      return {
        id: data.id as string,
        sealedAt: data.sealed_at as string | null,
        memberId: data.member_id as string,
        memberName: member.display_name,
        isSelf: member.account_id !== null && member.account_id === accountId,
        // `controlled_member_ids()`, client-side — and one function now rather than the
        // three hand-written copies this rule was spread across (see src/domain/member.ts).
        controlled: isControlledBy(member, accountId),
        readyAt: data.ready_at as string | null,
        joinedLateAt: data.joined_late_at as string | null,
        personalSetupDeadline: data.personal_setup_deadline as string | null,
        year: {
          id: year.id,
          calendarYear: year.calendar_year,
          status: year.status,
          centerMode: year.center_mode,
          setupDeadline: year.setup_deadline,
          playOpensAt: year.play_opens_at,
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
        // Unfiltered server-side, so a six-person Family pulls six Boards and 150 Tiles to
        // render one or two rows. Deliberate: narrowing it would mean first fetching which
        // Members the caller controls, and a second round trip costs more than the rows.
        // RLS permits every one of them — nothing here is a leak, only weight.
        .select('id, member_id, sealed_at, ready_at, joined_late_at, created_at, member:member_id (id, display_name, account_id, guardian_account_id, status), tiles (position, goal_id)')
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
        if (!isControlledBy(member, accountId)) return [];

        const tiles = (row.tiles ?? []) as { position: number; goal_id: string | null }[];
        return [
          {
            id: row.id as string,
            memberId: member.id,
            memberName: member.display_name,
            isManaged: isManaged(member),
            sealedAt: row.sealed_at as string | null,
            readyAt: row.ready_at as string | null,
            joinedLateAt: row.joined_late_at as string | null,
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
export function useBoard(boardId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: boardKey(boardId ?? 'none', accountId ?? 'anonymous'),
    // Waits for the Account as well as the Board, like `useBoardHead`. Firing before the
    // session resolves is a guaranteed 401 against RLS.
    enabled: boardId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<DraftTile[]> => {
      const { data, error } = await supabase
        .from('tiles')
        .select('id, position, goal:goal_id (id, text, target, unit, unit_canonical, category, pace_hint, sharpened_at), family_goal:family_goal_id (text, completed_at)')
        .eq('board_id', boardId ?? '')
        .order('position', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).map((row) => {
        const familyGoal = row.family_goal as unknown as {
          text: string;
          completed_at: string | null;
        } | null;
        return {
          id: row.id as string,
          position: row.position as number,
          goal: (row.goal as unknown as Goal | null) ?? null,
          familyGoalText: familyGoal?.text ?? null,
          familyGoalCompletedAt: familyGoal?.completed_at ?? null,
        };
      });
    },
  });
}

/**
 * How many Increments each Tile on this Board has.
 *
 * Counted here rather than read from a column, because §11.4 is explicit: progress is
 * `COUNT(increments)` and **must not be denormalised** — a cached counter and an
 * append-only log drift, and the log is the source of truth.
 *
 * Keyed by `tile_id`, which is what `increments` actually references. A Goal is reachable
 * only through its Tile, and a Swap replaces the Goal while the Tile stays put (§18.6) —
 * so counting per Tile is also the only version that survives slice 18.
 */
export const tileCountsKey = (tileIds: readonly string[], accountId: string) =>
  // Sorted so the key is stable: the same Board must not produce a different cache entry
  // because two Tiles arrived in a different order.
  ['tile-counts', [...tileIds].sort().join(','), accountId] as const;

/** PostgREST's `max_rows`, from `supabase/config.toml`. A full page means there is more. */
const PAGE = 1000;

export function useTileCounts(tileIds: readonly string[], accountId: string | undefined) {
  return useQuery({
    // Carries the Account, like every other key here. `increments_family_read` filters on
    // `visible_member_ids()`, so these rows are not the same for every caller — the same
    // 25 Tile ids answer real counts for a Member of the Family and nothing at all for
    // anyone else, which is exactly the shape of the cross-Account leak the handoff warns
    // about twice.
    queryKey: tileCountsKey(tileIds, accountId ?? 'anonymous'),
    enabled: tileIds.length > 0 && accountId !== undefined,
    queryFn: async (): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {};

      // Paged, because PostgREST truncates at `max_rows = 1000` and reports no error when
      // it does. `goals.target` has no upper bound, so one "read 2000 pages" Goal — or a
      // busy Board in aggregate — silently loses Increments, and a complete Tile renders
      // as `sprouting` with its Line missing from the pip strip. A count that quietly
      // shrinks is worse than a slow one: §11.4 makes `COUNT(increments)` the source of
      // truth precisely so it cannot drift.
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('increments')
          .select('tile_id')
          // An explicit order, or the pages are not a partition: without one PostgREST
          // gives no stable row order and successive ranges may repeat and omit rows.
          .order('id', { ascending: true })
          .in('tile_id', [...tileIds])
          .range(from, from + PAGE - 1);
        if (error !== null) throw error;

        const rows = data ?? [];
        for (const row of rows) {
          const id = row.tile_id as string;
          counts[id] = (counts[id] ?? 0) + 1;
        }
        if (rows.length < PAGE) return counts;
      }
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
  /**
   * True on the write that follows a successful Sharpening — it stamps `sharpened_at` and
   * spends the Goal's one sharpen (§4.2, migration 33).
   *
   * The stamp is set once and never cleared, so this being `false` on a later edit does
   * not hand the sharpen back. Editing a sharpened Goal by hand is what §4.2 invites.
   */
  sharpened?: boolean;
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
        sharpened: draft.sharpened ?? false,
      });
      if (error !== null) throw error;
      return data as Goal;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardPrefix(boardId) });
      // The count on the Family screen's Board rows moves with every write. A prefix match
      // rather than the exact key, because the Year and Account are not in scope here.
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}

/**
 * Why `mark_board_ready()` would not take this, phrased for the Member who tapped it.
 *
 * Three raises, three SQLSTATEs, and that is deliberate on the migration's side (41): a
 * sealed Board, an incomplete Board and somebody else's Board are three different things
 * to be told, and one code covering all three is how `writeGoalFailureCopy`'s centre
 * branch became unreachable. Matched on the code, never on message text.
 *
 * All three should be unreachable from the screen — the control is offered only on a full,
 * unsealed Board the caller controls — so every sentence here describes a race rather than
 * a mistake, and none of them blames anybody for it.
 */
export const readyFailureCopy = (thrown: unknown): string => {
  const { code, message } = failure(thrown);
  // The Family finished while this screen was open — which is the good outcome, said
  // plainly rather than as an error about a tap that turned out to be unnecessary.
  if (code === 'PT403') return 'This board has already sealed.';
  if (code === 'PT409') return 'Every square needs a goal before the board is done.';
  if (code === '42501' && /frozen/i.test(message)) return 'This year has finished.';
  // 'no such Board' shares the ownership code, and "isn't yours" is the wrong sentence for
  // a Board that is not there at all — which is what a deleted Member or a stale deep link
  // looks like.
  if (code === '42501' && /no such Board/i.test(message)) {
    return 'That board isn’t there any more.';
  }
  if (code === '42501') return 'That board isn’t yours to finish.';
  return 'That didn’t save. Have another go in a moment.';
};

/**
 * §22.2 — this Member says their Board is done.
 *
 * The RPC does two things and only one of them is about this Board: it records the
 * declaration, and if that was the last one in the Year it seals every Board in the
 * Family. So the invalidation is deliberately wide. A narrow one would leave four other
 * Boards on screen as drafts, a Year still reading `setup`, and a Family screen still
 * counting down to a deadline that had stopped mattering.
 *
 * Argument names are checked against `20260801000041_ready_and_the_early_seal.sql`. A
 * wrong name here fails at runtime, not at compile time — `lib/rpc-signatures.test.ts` is
 * what catches it, and only because the function name is written as a literal below.
 */
export function useMarkBoardReady(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase.rpc('mark_board_ready', { board_id: boardId });
      if (error !== null) throw error;
    },
    onSuccess: () => {
      // **Every** Board's Tiles, not just this one's. Sealing runs `deal_positions()` over
      // every Board in the Year, and that permutes `goal_id` BETWEEN Tiles — so a Guardian
      // who marks their own Board ready as the last one and then opens the child's Board
      // inside `staleTime` would see the child's goals drawn on the wrong squares, with
      // `renderTiles` and `completedLines` computed from those positions.
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['board-head'] });
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
      void queryClient.invalidateQueries({ queryKey: ['readiness'] });
      // The Centre resolves inside the same seal, and both Votes go to `resolved`. The
      // Centre screen's own fallback cannot notice: it compares `closes_at` to now, which
      // is exactly the check an EARLY resolution defeats — the date is still weeks away.
      void queryClient.invalidateQueries({ queryKey: ['centre'] });
      // The Year's own status moves from `setup` to `active` on the last declaration,
      // and it is the Family screen's whole headline.
      void queryClient.invalidateQueries({ queryKey: ['years'] });
    },
  });
}

/** §22.4 — and takes it back, which stays possible until it was the last one. */
export function useClearBoardReady(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase.rpc('clear_board_ready', { board_id: boardId });
      if (error !== null) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardPrefix(boardId) });
      void queryClient.invalidateQueries({ queryKey: ['board-head'] });
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
      void queryClient.invalidateQueries({ queryKey: ['readiness'] });
    },
  });
}

/**
 * Where the whole Family has got to (§22.3).
 *
 * Every Board in the Year, not just the ones the caller may author on — which is exactly
 * the opposite of `useMyBoards`, and for the opposite reason. "Waiting on Bob" is a fact
 * about the Family, and a list narrowed to the caller's own Boards can only ever say the
 * caller is waiting on themselves. `boards_read` is Family-wide, so RLS already draws the
 * boundary this needs and no filtering is wanted here.
 *
 * Pending Members are excluded because they have no Board at all (§3.2) — the join simply
 * never produces them — and a Member whose row is unreadable is dropped rather than
 * counted as an unnamed straggler.
 */
export const readinessKey = (yearId: string, accountId: string) =>
  ['readiness', yearId, accountId] as const;

export function useYearReadiness(yearId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: readinessKey(yearId ?? 'none', accountId ?? 'anonymous'),
    enabled: yearId !== undefined && accountId !== undefined,
    queryFn: async (): Promise<ReadinessBoard[]> => {
      const { data, error } = await supabase
        .from('boards')
        .select('ready_at, sealed_at, created_at, member:member_id (display_name, account_id, guardian_account_id, status)')
        .eq('year_id', yearId ?? '')
        .order('created_at', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).flatMap((row) => {
        const member = row.member as unknown as {
          display_name: string;
          account_id: string | null;
          guardian_account_id: string | null;
          status: string;
        } | null;
        if (member === null || member.status !== 'active') return [];
        return [
          {
            displayName: member.display_name,
            readyAt: row.ready_at as string | null,
            sealedAt: row.sealed_at as string | null,
            // Exactly `controlled_member_ids()`, and used only so the Family screen
            // cannot read "waiting on Derek" to Derek.
            isSelf: isControlledBy(member, accountId),
          },
        ];
      });
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
      void queryClient.invalidateQueries({ queryKey: boardPrefix(boardId) });
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}
