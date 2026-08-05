/**
 * The Account screen's reads and writes (FRONTEND_DESIGN §4.6, PRD §1.5).
 *
 * Two things live here that live nowhere else, and both are about the difference between
 * an Account and a Member (CONTEXT.md):
 *
 *   - **A name is per Family, not per Account.** `members.display_name` is what the Feed,
 *     the roster and every notification say, and somebody in two Families is two Members
 *     with two names. So "change my name" is one write per Membership, which is why the
 *     grant is column-scoped on `members` rather than existing on `accounts` at all.
 *   - **Deleting is `delete_account()` and nothing else.** It removes the `auth.users` row;
 *     everything cascades from there. There is no client-side teardown to write, and any
 *     attempt at one would leave a half-deleted Account if it failed halfway.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { failedWith } from '../failure';
import { supabase } from '../supabase';

/**
 * The Managed Members this Account is answerable for, across every Family (§4.6's "people
 * you look after").
 *
 * Keyed on the Account because that is the question — `members_read` is Family-wide and
 * would answer with every child in every Family the caller can see, including other
 * people's. `guardian_account_id` is the predicate that makes them *theirs*: §4.7 says the
 * Guardian "created the profile, plays on that person's behalf, and is accountable for
 * anything posted under them", and this list is that accountability made visible.
 */
export const managedByMeKey = (accountId: string) => ['managed-by-me', accountId] as const;

export interface ManagedProfile {
  id: string;
  displayName: string;
  familyId: string;
  familyName: string;
}

export function useManagedByMe(accountId: string | undefined) {
  return useQuery({
    queryKey: managedByMeKey(accountId ?? 'anonymous'),
    enabled: accountId !== undefined,
    queryFn: async (): Promise<ManagedProfile[]> => {
      const { data, error } = await supabase
        .from('members')
        .select('id, display_name, family_id, status, family:family_id (name)')
        .eq('guardian_account_id', accountId ?? '')
        .order('joined_at', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).flatMap((row) => {
        // A removed profile keeps its rows for the Feed's sake; it is not somebody the
        // Guardian still looks after.
        if ((row.status as string) !== 'active') return [];
        const family = row.family as unknown as { name: string } | null;
        return [
          {
            id: row.id as string,
            displayName: row.display_name as string,
            familyId: row.family_id as string,
            familyName: family?.name ?? '',
          },
        ];
      });
    },
  });
}

/**
 * §4.6 — change the name a Family sees.
 *
 * One Membership at a time, deliberately. Changing it everywhere at once would be a single
 * control quietly editing rows in Families the Member is not looking at — and the whole
 * point of a Member being per-Family is that nothing crosses a Family boundary (§8.1).
 *
 * The grant is `update (display_name, avatar_url, digest_opt_in, status)` and that column
 * scoping is load-bearing: it is what stops the same policy being used to set `role` or to
 * move a Member into another Family. Any statement touching a fifth column is refused at
 * the grant level, so this writes exactly one.
 */
export function useRenameMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rename: { memberId: string; name: string }): Promise<void> => {
      // `.select()` is not decoration. `members_self_update` is a `using` policy, so a
      // refused UPDATE matches nothing and PostgREST answers 204 with no error object —
      // the same trap `useDeleteIncrement` documents. Asking for the row back makes an
      // empty result the refusal it is.
      const { data, error } = await supabase
        .from('members')
        .update({ display_name: rename.name.trim() })
        .eq('id', rename.memberId)
        .select('id');
      if (error !== null) throw error;
      if ((data ?? []).length === 0) throw new Error('that name could not be changed');
    },
    onSuccess: () => {
      // Everything that renders a Member's name: the Family list, the roster, the Boards
      // list, and every Feed row (which resolves names through the roster).
      void queryClient.invalidateQueries({ queryKey: ['families'] });
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-by-me'] });
    },
  });
}

/**
 * §19.1 — the weekly Digest. **Opt-in, default off**, and the default is the point: §19 is
 * a pull back into the game for Members who want one, and §7.11 forbids anything that
 * reaches for a Member who did not ask.
 *
 * Per Member, so somebody in two Families chooses twice. That is not an oversight: a
 * Digest is one Family's week (§19.2), and the Family is the unit of privacy.
 *
 * Distinct from the Almanac switch on the notifications screen, which decides whether the
 * *push* is delivered to this Account. This decides whether a Digest is built for this
 * Member at all — `build_and_send_digest()` reads it directly. One says "send me this
 * Family's week"; the other says "let this handset buzz for it".
 *
 * `20260801000011_managed_members.sql` constrains a Managed Member's `digest_opt_in` to
 * false, so this is never offered for one — §4.7: they receive no notifications.
 */
export function useSetDigestOptIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: { memberId: string; optIn: boolean }): Promise<void> => {
      const { data, error } = await supabase
        .from('members')
        .update({ digest_opt_in: change.optIn })
        .eq('id', change.memberId)
        .select('id');
      if (error !== null) throw error;
      if ((data ?? []).length === 0) throw new Error('that preference could not be saved');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['families'] });
    },
  });
}

/** What to tell somebody whose rename did not land. */
export const renameFailureCopy = (thrown: unknown): string => {
  // `display_name` has a length check on `members`.
  if (failedWith(thrown, '23514')) return 'A name needs to be between 1 and 60 characters.';
  if (failedWith(thrown, '42501')) return 'That name isn’t yours to change.';
  return 'That didn’t save. Have another go in a moment.';
};

/**
 * §1.5 — delete the Account. Required from day one; it is an App Store condition and the
 * product is meant to be listed.
 *
 * `delete_account()` takes no arguments and can only ever delete `auth.uid()`, so it is
 * not pointable at anyone else. It removes the `auth.users` row and everything cascades:
 * `accounts`, then `members` by **both** `account_id` and `guardian_account_id`, then
 * Boards, Tiles, Increments, Attachments, Milestones, Revisions, Ballots and Proposals.
 *
 * **That second cascade is the one the screen has to be honest about.** A Guardian
 * deleting their Account deletes their children's Boards with it — see the note on the
 * copy in `app/account.tsx`.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase.rpc('delete_account');
      if (error !== null) throw error;
      // The session outlives the row it refers to. Signing out is what makes the app
      // notice — without it the next query answers 401 against a token for a user that no
      // longer exists, which reads as a network problem rather than as "you did that".
      await supabase.auth.signOut();
    },
  });
}
