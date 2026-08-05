/**
 * Wrapped — reading the story of a finished Year (PRD §20, FRONTEND_DESIGN §4 "Wrapped").
 *
 * **This file only reads.** Every function behind Wrapped is revoked from `authenticated`:
 * `generate_wrapped`, `finalize_wrapped`, `freeze_year`, `freeze_due_years`,
 * `member_year_stats`, `family_year_cards` and `freeze_instant` are all `service_role` or
 * `pg_cron` only. Freezing is a clock, and the Awards are computed by the `wrap` Edge
 * Function calling `assignAwards()` from `src/domain/awards.ts` and handed to
 * `finalize_wrapped()`. A client that recomputed any of it would be a second author for
 * numbers the server materialized precisely so they could never move again (§20.2).
 *
 * Three tables, `grant select` only, read-only forever (§20.10):
 *
 *   - `wrapped` — one row per Year, holding `family_cards` (§20.5)
 *   - `wrapped_member_cards` — one row per Member, holding `stats` (§20.4)
 *   - `wrapped_awards` — `(member, axis, label, detail)`, and **no `rank` column, ever**
 *
 * All three policies are Family- or Member-wide, exactly like `members_read` and
 * `boards_read` — `wrapped_read` is "any Year of any Family you can see", and the two child
 * policies are "any Member you can see", which spans every Year that Member has ever
 * played. So the scoping is this file's job: one read of `wrapped` filtered to the Year,
 * with the children embedded through their `wrapped_id` foreign key, which is what makes
 * them the rows of *this* Year and no other.
 */

import { useQuery } from '@tanstack/react-query';
import type { AwardRow, FamilyStats, MemberStats } from '../../src/domain/wrapped';
import { supabase } from '../supabase';

/**
 * Carries the Account for the same reason every key in this directory does — see the note
 * on `familiesKey`, which is a privacy control rather than a cache nicety.
 *
 * It matters more here than most. `wrapped_member_cards_read` and `wrapped_awards_read` key
 * on `visible_member_ids()`, so the same `yearId` answers a Family's whole Wrapped for one
 * Account and nothing at all for another. A bare key plus a `staleTime` this long would
 * serve the previous Account's Family history for as long as the app stayed open.
 */
export const wrappedKey = (yearId: string, accountId: string) =>
  ['wrapped', yearId, accountId] as const;

export interface Wrapped {
  /** When the Freeze built it. Never moves again (§20.2). */
  generatedAt: string;
  family: FamilyStats;
  /** One per Member who had a Board in this Year — nobody else has a card. */
  memberCards: { memberId: string; stats: MemberStats }[];
  awards: AwardRow[];
}

/* ------------------------------------------------------------------------------------- *
 * Reading the jsonb
 *
 * `family_cards` and `stats` arrive as `unknown`, and a `stats` field cast rather than
 * parsed is how a card renders `[object Object]` — or renders nothing at all, on a Year
 * whose Wrapped can never be regenerated because the Year underneath it is permanently
 * read-only. The shapes below are the ones `generate_wrapped()` builds, as amended by
 * `20260801000029_review_fixes.sql` §5 and §6; the server's own `stats_has_the_cards` CHECK
 * guards the same key list from the other side.
 * ------------------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** `null` rather than a fallback: a missing number and a zero are different facts. */
const nullableNum = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const memberStatsOf = (raw: unknown): MemberStats => {
  const s = isRecord(raw) ? raw : {};
  const exceeded = isRecord(s['most_exceeded']) ? s['most_exceeded'] : null;
  return {
    tilesCompleted: num(s['tiles_completed']),
    // 25 and 12 are constants on the server side too, but they are read rather than assumed
    // — the card states what was materialized, and a Board is 25 Tiles because §8.2 makes it
    // one, not because this file says so.
    tilesTotal: num(s['tiles_total'], 25),
    linesCompleted: num(s['lines_completed']),
    linesTotal: num(s['lines_total'], 12),
    blackout: s['blackout'] === true,
    increments: num(s['increments']),
    biggestMonth: str(s['biggest_month']),
    biggestMonthIncrements: num(s['biggest_month_increments']),
    worstMonthIncrements: num(s['worst_month_increments']),
    comebackDelta: num(s['comeback_delta']),
    longestGoalSpanDays: nullableNum(s['longest_goal_span_days']),
    longestGoal: str(s['longest_goal']),
    // `numeric` in Postgres, which PostgREST sends as a JSON number here because
    // `percentile_cont` returns double precision — but a string would be a silent zero, so
    // the guard stays.
    medianGapDays: nullableNum(s['median_gap_days']),
    notes: num(s['notes']),
    photos: num(s['photos']),
    swapsUsed: num(s['swaps_used']),
    firstBingoAt: str(s['first_bingo_at']),
    mostExceeded:
      exceeded === null
        ? null
        : {
            goal: str(exceeded['goal']) ?? '',
            target: num(exceeded['target']),
            actual: num(exceeded['actual']),
          },
  };
};

const familyStatsOf = (raw: unknown): FamilyStats => {
  const f = isRecord(raw) ? raw : {};
  const goal = isRecord(f['family_goal']) ? f['family_goal'] : null;
  return {
    increments: num(f['increments']),
    units: array(f['units']).flatMap((u) => {
      if (!isRecord(u)) return [];
      const unit = str(u['unit']);
      return unit === null ? [] : [{ unit, total: num(u['total']) }];
    }),
    categories: array(f['categories']).flatMap((c) => {
      if (!isRecord(c)) return [];
      const category = str(c['category']);
      return category === null ? [] : [{ category, increments: num(c['increments']) }];
    }),
    busiestMonth: str(f['busiest_month']),
    familyGoal:
      goal === null
        ? null
        : {
            text: str(goal['text']) ?? '',
            completed: goal['completed'] === true,
            completedBy: str(goal['completed_by']),
          },
    // Deliberately unfiltered and deliberately unsorted. `..._029` §6 removed the Bingo and
    // Blackout narrowing because a chronological list of who got a Bingo first *is* a
    // ranking (§13.5), and the server already ordered these by `created_at`. Re-sorting
    // them on any other key here would put the ladder back.
    milestones: array(f['milestones']).flatMap((m) => {
      if (!isRecord(m)) return [];
      const member = str(m['member']);
      const type = str(m['type']);
      const at = str(m['at']);
      return member === null || type === null || at === null ? [] : [{ member, type, at }];
    }),
    nextYear: nullableNum(f['next_year']),
  };
};

/**
 * One Year's Wrapped: the Family's cards, every Member's card, and every Award.
 *
 * **One round trip, and it never fires again.** §20.2 is explicit that Wrapped "is read many
 * times, changes never, and must render instantly", and §20.1 makes a frozen Year
 * permanently read-only — so `staleTime: Infinity` is not a cache optimisation, it is the
 * truth about the data. A refetch could only ever return the same bytes, and paying for one
 * on every focus would be paying for it on the one screen the PRD says has to be instant.
 * The Account is in the key, so a different Account never inherits this entry, and
 * `queryClient.clear()` on SIGNED_OUT empties it either way.
 *
 * The children are embedded rather than fetched separately, which is what scopes them. Both
 * child policies are Member-wide across every Year, so a standalone read of
 * `wrapped_member_cards` would answer with every Year a visible Member has ever played;
 * reached through `wrapped_id` from the one `wrapped` row of this Year, they cannot.
 *
 * No paging. A Family is capped at twenty Members (§4.5), so this is at most twenty member
 * cards and — one Award per Member per axis, eleven axes — a couple of hundred Awards,
 * comfortably inside PostgREST's `max_rows = 1000`. The Milestone timeline is inside
 * `family_cards` as jsonb and is one row however long it is.
 */
export function useWrapped(yearId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: wrappedKey(yearId ?? 'none', accountId ?? 'anonymous'),
    // Waits for the Account as well as the Year: firing before the session resolves caches
    // an empty Wrapped against the key the real Account will use a moment later, and with
    // `staleTime: Infinity` there is no refetch to correct it.
    enabled: yearId !== undefined && accountId !== undefined,
    staleTime: Infinity,
    queryFn: async (): Promise<Wrapped | null> => {
      const { data, error } = await supabase
        .from('wrapped')
        // One string literal, not a concatenation: supabase-js parses this at the type level
        // and `'a' + 'b'` widens to `string`, which turns every field access below into an
        // error against GenericStringError.
        .select('generated_at, family_cards, member_cards:wrapped_member_cards (member_id, stats), awards:wrapped_awards (member_id, axis, label, detail)')
        .eq('year_id', yearId ?? '')
        // A Year that has not frozen yet simply has no row, and that is not an error — it
        // is the ordinary state of every Year until 1 January (§20.1).
        .maybeSingle();
      if (error !== null) throw error;
      if (data === null) return null;

      const memberCards = (data.member_cards ?? []) as unknown as {
        member_id: string;
        stats: unknown;
      }[];
      const awards = (data.awards ?? []) as unknown as {
        member_id: string;
        axis: string;
        label: string;
        detail: unknown;
      }[];

      return {
        generatedAt: data.generated_at as string,
        family: familyStatsOf(data.family_cards),
        memberCards: memberCards.map((row) => ({
          memberId: row.member_id,
          stats: memberStatsOf(row.stats),
        })),
        awards: awards.map(
          (row): AwardRow => ({
            memberId: row.member_id,
            axis: row.axis,
            label: row.label,
            detail: isRecord(row.detail) ? row.detail : {},
          }),
        ),
      };
    },
  });
}
