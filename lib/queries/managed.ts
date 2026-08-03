/**
 * Managed Members — children who play through a Guardian's Account (PRD §4, ADR-0003).
 *
 * The Account is not the player. That is the whole of ADR-0003, and it is why every write
 * path in this app names a Member rather than assuming auth.uid() is one.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { rosterKey } from './invitations';

/**
 * §4.5 — removing a child takes their Board, Goals, Increments and Attachments with it.
 *
 * A different RPC from remove_member(), and the difference is the point: remove_member()
 * is the Organizer administering a roster, while this is a Guardian removing a profile
 * they created and are accountable for (§4.3). Requiring the Organizer would mean a parent
 * could add a child and then not be able to delete them.
 */
export function useRemoveManagedMember(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.rpc('remove_managed_member', { member_id: memberId });
      if (error !== null) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(familyId) }),
  });
}

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
