/**
 * Years, and opening one (PRD §5).
 *
 * A Year is the season of play: one Board per Member per Year (CONTEXT.md). Everything
 * past this point is scoped to exactly one.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { failedWith } from '../failure';
import { supabase } from '../supabase';

/**
 * Why `open_year()` refused, in words the Organizer can act on.
 *
 * Here rather than on `app/family/[id].tsx`, for the reason `incrementFailureCopy` is in
 * `increments.ts`: the module that owns the RPC owns the sentence for its refusals.
 *
 * `calendarYear` is passed in because two of the three sentences name the Year, and the
 * screen is the only place that knows which one was being opened.
 *
 * All three are permanent — none of them is fixed by trying again — which is why one
 * message for all three was advice that could never work (§0.3). Matched on the SQLSTATE
 * through `lib/failure.ts` with the message kept as a second key; all three raises are in
 * `20260801000012_open_year.sql`.
 */
export const openYearFailureCopy = (thrown: unknown, calendarYear: number): string => {
  if (failedWith(thrown, '42501', /organizer/i)) return 'Only the Organizer can open a Year.';
  // 'this Family already has a % Year' — §5.1's one Year per Family per calendar year.
  if (failedWith(thrown, 'PT409', /already|exists/i)) return `${calendarYear} is already open.`;
  // 'that Year has already passed', raised as a bad argument rather than a permission.
  if (failedWith(thrown, '22023', /past|ended/i)) return 'That Year has already ended.';
  return 'That didn’t open. Have another go in a moment.';
};

export interface Year {
  id: string;
  calendar_year: number;
  status: 'setup' | 'active' | 'frozen';
  center_mode: 'shared' | 'personal' | 'undecided';
  setup_deadline: string;
  /**
   * When play opens — midnight on 1 January in the Family's timezone (§22.5).
   *
   * Not the same fact as `sealed_at`, and since §22 not the same fact as `setup_deadline`
   * either: a Family who all mark their Boards done in December seal in December, and
   * still start on 1 January.
   */
  play_opens_at: string;
  sealed_at: string | null;
  frozen_at: string | null;
}

export const yearsKey = (familyId: string) => ['years', familyId] as const;

/**
 * Every Year the Family has had, newest first.
 *
 * Frozen Years stay browsable forever as family history (§20.10), so this is a list rather
 * than a single current Year.
 */
export function useYears(familyId: string | undefined) {
  return useQuery({
    queryKey: yearsKey(familyId ?? 'none'),
    enabled: familyId !== undefined,
    queryFn: async (): Promise<Year[]> => {
      const { data, error } = await supabase
        .from('years')
        .select('id, calendar_year, status, center_mode, setup_deadline, play_opens_at, sealed_at, frozen_at')
        .eq('family_id', familyId ?? '')
        .order('calendar_year', { ascending: false });
      if (error !== null) throw error;
      return (data ?? []) as Year[];
    },
  });
}

/**
 * §5.1 — the Organizer opens a Year, one per Family per calendar year.
 *
 * The year to open is not asked for. §5.2 makes the Setup Window end on 1 January, so the
 * only Year anyone can be opening is the next one — offering a picker would be offering a
 * choice between one option and several errors.
 */
export function useOpenYear(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (calendarYear: number) => {
      const { data, error } = await supabase.rpc('open_year', {
        family_id: familyId,
        calendar_year: calendarYear,
      });
      if (error !== null) throw error;
      return data as Year;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: yearsKey(familyId) });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
}
