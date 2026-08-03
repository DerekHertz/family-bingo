/**
 * Managed Members — children who play through a Guardian's Account (PRD §4, ADR-0003).
 *
 * The Account is not the player. That is the whole of ADR-0003, and it is why every write
 * path in this app names a Member rather than assuming auth.uid() is one.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { rosterKey } from './invitations';

/** §4.4: no email, no password, no session — a name is all there is to give. */
export function useCreateManagedMember(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.rpc('create_managed_member', {
        family_id: familyId,
        display_name: name.trim(),
      });
      if (error !== null) throw error;
      return data as { id: string; display_name: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(familyId) }),
  });
}
