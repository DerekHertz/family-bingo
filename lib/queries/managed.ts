/**
 * Managed Members — children who play through a Guardian's Account (PRD §4, ADR-0003).
 *
 * The Account is not the player. That is the whole of ADR-0003, and it is why every write
 * path in this app names a Member rather than assuming auth.uid() is one.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { failedWith } from '../failure';
import { supabase } from '../supabase';
import { rosterKey } from './invitations';

/**
 * Why `create_managed_member()` refused, phrased for the Guardian.
 *
 * Here rather than on `app/family/child.tsx`, for the reason `incrementFailureCopy` is in
 * `increments.ts`: the module that owns the RPC owns the sentence for its refusals, and
 * `20260801000011_managed_members.sql` is where every `raise` below lives.
 *
 * Both are permanent refusals; "have another go" would be advice that never works (§0.3).
 * Matched on the SQLSTATE through `lib/failure.ts` with the message kept as a second key —
 * `PT409` and `42501` never appear in the sentence, so a message-only match was one
 * migration away from silently falling through to the generic line.
 *
 * The third raise, `22023` for a name outside 1–60 characters, is deliberately not here:
 * the screen refuses an empty name before it calls, and `maxLength` stops the other end.
 * It would land on the generic sentence, which is the honest answer to a case the client
 * should never produce.
 */
export const managedMemberFailureCopy = (thrown: unknown): string => {
  // 'this Family is full (% of %)' — a child takes a seat like anyone else (§4.5).
  if (failedWith(thrown, 'PT409', /full/i)) {
    return 'This Family is full for now. A child takes a seat like anyone else.';
  }
  // 'only an active Member of this Family may add a child profile' — §4 puts this with
  // any adult Member, not just the Organizer, because a Guardian is a parent rather than
  // an administrator (§4.3).
  if (failedWith(thrown, '42501', /not a member|only|permission|denied/i)) {
    return 'Only someone already in this Family can add a child.';
  }
  return 'That didn’t save. Have another go in a moment.';
};

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
