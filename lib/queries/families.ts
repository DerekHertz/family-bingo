/**
 * Reading and creating Families.
 *
 * Every query here goes through PostgREST or an RPC with the Member's own session, so RLS
 * decides every row (ADR-0004). Nothing in this file filters by Family — it cannot see
 * one it should not, so it does not have to remember to ask.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { familyNameProblem } from '../../src/domain/family';
import { supabase } from '../supabase';

export { FAMILY_NAME, familyNameProblem } from '../../src/domain/family';

export interface Family {
  id: string;
  name: string;
  timezone: string;
  /** The caller's own Member row in this Family. One per Family, never more. */
  member: { id: string; display_name: string; role: 'organizer' | 'member' };
}

export const familiesKey = ['families'] as const;

/**
 * Every Family the signed-in Account is an active Member of.
 *
 * §2.2: an Account may belong to several, and every screen past this one is scoped to
 * exactly one. The list is the switcher's data as much as the home screen's.
 */
export function useFamilies() {
  return useQuery({
    queryKey: familiesKey,
    queryFn: async (): Promise<Family[]> => {
      // Read from `members` rather than `families`: it is the caller's membership that
      // makes a Family visible, and starting there makes the row set self-evidently the
      // caller's own.
      const { data, error } = await supabase
        .from('members')
        .select('id, display_name, role, family:family_id (id, name, timezone)')
        .eq('status', 'active')
        .order('joined_at', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).flatMap((row) => {
        const family = row.family as unknown as
          | { id: string; name: string; timezone: string }
          | null;
        if (family === null) return [];
        return [
          {
            ...family,
            member: {
              id: row.id as string,
              display_name: row.display_name as string,
              role: row.role as 'organizer' | 'member',
            },
          },
        ];
      });
    },
  });
}

/**
 * §2.1 — the Family and its Organizer in one transaction.
 *
 * An RPC rather than two inserts, because a Family with no Organizer is a Family nobody
 * can administer and there is no way to repair it from the client (api.md §2.1).
 */
export function useCreateFamily() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, timezone }: { name: string; timezone: string }) => {
      // The database enforces this too; checking here saves a round trip and lets the
      // screen say something specific instead of surfacing a constraint violation.
      const problem = familyNameProblem(name);
      if (problem !== null) throw new Error(problem);

      const { data, error } = await supabase.rpc('create_family', {
        name: name.trim(),
        timezone,
      });
      if (error !== null) throw error;
      return data as { id: string; name: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: familiesKey }),
  });
}
