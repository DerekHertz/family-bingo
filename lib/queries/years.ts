/**
 * Years, and opening one (PRD §5).
 *
 * A Year is the season of play: one Board per Member per Year (CONTEXT.md). Everything
 * past this point is scoped to exactly one.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

export interface Year {
  id: string;
  calendar_year: number;
  status: 'setup' | 'active' | 'frozen';
  center_mode: 'shared' | 'personal' | 'undecided';
  setup_deadline: string;
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
        .select('id, calendar_year, status, center_mode, setup_deadline, sealed_at, frozen_at')
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
