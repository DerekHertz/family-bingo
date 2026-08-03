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

/**
 * Keyed by Account, which is a privacy control rather than a cache nicety.
 *
 * A bare ['families'] key plus a QueryClient that outlives sign-out meant signing out of
 * one Account and into another inside the 5-minute gcTime served the FIRST Account's
 * Families — and `staleTime` made the entry fresh, so there was not even a refetch to
 * correct it. One Account reading another's Family names and Members is exactly what §8.1
 * forbids. The key stops it; `queryClient.clear()` on SIGNED_OUT in app/_layout.tsx stops
 * it again.
 */
export const familiesKey = (accountId: string) => ['families', accountId] as const;

/**
 * Every Family the signed-in Account is an active Member of.
 *
 * §2.2: an Account may belong to several, and every screen past this one is scoped to
 * exactly one. The list is the switcher's data as much as the home screen's.
 */
export function useFamilies(accountId: string | undefined) {
  return useQuery({
    queryKey: familiesKey(accountId ?? 'anonymous'),
    // Nothing to read without a session, and firing anyway caches a 42501 against the key
    // a real Account will use a moment later.
    enabled: accountId !== undefined,
    queryFn: async (): Promise<Family[]> => {
      // Read from `members` rather than `families`: it is the caller's membership that
      // makes a Family visible at all.
      //
      // `account_id` is the filter that matters, and its absence was a bug rather than an
      // omission. members_read is deliberately Family-WIDE (schema.md §4) — every Member
      // of every visible Family comes back — so a six-person Family produced six identical
      // cards, six duplicate React keys, and a stranger's name under each. The caller's own
      // row is the one their Account backs.
      //
      // Managed Members are excluded by the same clause: a Guardian controls them, but they
      // are not the Guardian, and this list is "Families you are in" (§2.2).
      const { data, error } = await supabase
        .from('members')
        .select('id, display_name, role, joined_at, family:family_id (id, name, timezone)')
        .eq('account_id', accountId ?? '')
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
      // The screen checks this before calling, so reaching it means a caller skipped the
      // check rather than a Member typing something odd. Kept as the boundary's own guard,
      // not as a message anybody reads.
      const problem = familyNameProblem(name);
      if (problem !== null) throw new Error(problem);

      const call = (zone: string) =>
        supabase.rpc('create_family', { name: name.trim(), timezone: zone });

      let { data, error } = await call(timezone);

      // A handset can report a zone newer than the server's tzdata —
      // `America/Ciudad_Juarez` is the usual example — and create_family() raises 22023 on
      // anything absent from pg_timezone_names. Retrying identically never works, so the
      // Member would simply never be able to create a Family. UTC is wrong by up to a day
      // for deadlines (§8.3 T1) and is fixable in Account; being unable to start is not.
      if (error !== null && error.code === '22023' && timezone !== 'UTC') {
        ({ data, error } = await call('UTC'));
      }
      if (error !== null) throw error;
      return data as { id: string; name: string };
    },
    // Prefix match: invalidates every Account's list, which is one wasted refetch at most
    // and cannot miss the one that actually changed.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['families'] }),
  });
}
