/**
 * Invitations, and the roster they fill.
 *
 * Two gates, and §3.5 says not to simplify either away: single-use handles a link
 * forwarded into a group chat AFTER first use, approval handles one forwarded BEFORE it.
 * Both are required because of what sits behind the boundary.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeCode } from '../../src/domain/invitation';
import { isManaged } from '../../src/domain/member';
import { supabase } from '../supabase';

export { CODE_LENGTH, codeProblem, normalizeCode } from '../../src/domain/invitation';

/** §4.5 — twenty Members to a Family, and twenty invitations. */
export const SEATS = 20;

export interface RosterMember {
  id: string;
  display_name: string;
  role: 'organizer' | 'member';
  status: 'pending' | 'active';
  is_managed: boolean;
  /**
   * Who backs this Member — the two columns `controlled_member_ids()` is built from
   * (`src/domain/member.ts`).
   *
   * Carried rather than reduced to a boolean here, because "may *I* act as them" is an
   * answer about the caller and this list is cached per Family, not per Account. Any
   * screen wanting that answer runs `isControlledBy` over these.
   */
  account_id: string | null;
  guardian_account_id: string | null;
}

export interface OpenInvitation {
  id: string;
  expires_at: string;
}

export const rosterKey = (familyId: string) => ['roster', familyId] as const;
export const pendingKey = (accountId: string) => ['pending', accountId] as const;

/**
 * The Families the caller has asked to join and is still waiting on.
 *
 * §3.2 stops them reading anything about those Families — including their own Member row —
 * so without this the app cannot tell them they are waiting after a relaunch, and Home
 * shows first-run copy instead. pending_memberships() returns only their own rows and the
 * Family name they were already given.
 */
export function usePendingMemberships(accountId: string | undefined) {
  return useQuery({
    queryKey: pendingKey(accountId ?? 'anonymous'),
    enabled: accountId !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pending_memberships');
      if (error !== null) throw error;
      return (data ?? []) as {
        member_id: string;
        family_id: string;
        family_name: string;
        asked_at: string;
      }[];
    },
  });
}

/**
 * Everyone in the Family, and every invitation still outstanding.
 *
 * Ordered by join order, never by anything else (§7.2) — this is a roster, and the moment
 * it sorts by activity it becomes a ladder.
 */
export function useRoster(familyId: string | undefined) {
  return useQuery({
    queryKey: rosterKey(familyId ?? 'none'),
    enabled: familyId !== undefined,
    queryFn: async () => {
      const [members, invitations] = await Promise.all([
        supabase
          .from('members')
          // `account_id` is what `isManaged` and `isControlledBy` read (§4.4,
          // `controlled_member_ids()`). It was missing, so this list had to spell
          // "is a child" its own second way — `guardian_account_id !== null` — and could
          // not answer "may this Account act as them" at all.
          .select('id, display_name, role, status, account_id, guardian_account_id')
          .eq('family_id', familyId ?? '')
          .order('joined_at', { ascending: true }),
        supabase
          .from('invitations')
          .select('id, expires_at')
          .eq('family_id', familyId ?? '')
          .is('used_at', null)
          .is('revoked_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true }),
      ]);
      if (members.error !== null) throw members.error;
      // Not thrown: invitations_organizer_read denies a plain Member, which is correct and
      // is not this screen failing. They see the roster without the outstanding codes.
      const canSeeInvitations = invitations.error === null;

      return {
        canSeeInvitations,
        members: (members.data ?? []).map(
          (m): RosterMember => ({
            id: m.id as string,
            display_name: m.display_name as string,
            role: m.role as 'organizer' | 'member',
            status: m.status as 'pending' | 'active',
            // The clay dot follows a Managed Member everywhere they appear (§3), and it
            // is the same predicate everywhere too — this row used to say
            // `guardian_account_id !== null` while the Board and Centre queries said
            // `account_id === null` about the same person.
            is_managed: isManaged(m),
            account_id: m.account_id as string | null,
            guardian_account_id: m.guardian_account_id as string | null,
          }),
        ),
        invitations: (invitations.data ?? []) as OpenInvitation[],
      };
    },
  });
}

/**
 * Mint a code. §3.1: single-use, seven days.
 *
 * The plaintext comes back from this call and from nowhere else — only its hash is stored,
 * so a code that is closed without being shared is gone. That is deliberate, and the
 * screen has to keep it on screen rather than expect to re-read it.
 */
export function useCreateInvitation(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_invitation', { family_id: familyId });
      if (error !== null) throw error;
      const row = (data as { invitation_id: string; code: string; expires_at: string }[])[0];
      if (row === undefined) throw new Error('no invitation returned');
      return row;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(familyId) }),
  });
}

export function useRedeemInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('redeem_invitation', {
        code: normalizeCode(code),
      });
      if (error !== null) throw error;
      return data as { id: string; family_id: string; status: string };
    },
    // Redeeming creates a pending Member: the Families list is unchanged (still not
    // active) but the pending list is not. Targeted, rather than dropping every Account's
    // cache on the floor.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pending'] });
      void queryClient.invalidateQueries({ queryKey: ['families'] });
    },
  });
}

/** §3.3 and §3.4 — the Organizer's four verbs, each one RPC. */
export function useRosterActions(familyId: string) {
  const queryClient = useQueryClient();
  // Approving changes who is in the Family, which changes both the roster AND whether the
  // approved Account sees it in their own list. Both keys, every time.
  const after = {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rosterKey(familyId) });
      void queryClient.invalidateQueries({ queryKey: ['families'] });
      void queryClient.invalidateQueries({ queryKey: ['pending'] });
    },
  };

  /**
   * Each RPC is named as a literal at its own call site, rather than passed into a
   * `call(fn, arg)` helper.
   *
   * The helper read better and hid all four from `lib/rpc-signatures.test.ts`, which can
   * only check a name it can see. That guard exists because an RPC argument name is
   * verified by nothing until runtime — and these four are the Organizer's entire roster
   * surface, which is precisely the code that should not be the unchecked part.
   */
  const raise = ({ error }: { error: { message: string } | null }) => {
    if (error !== null) throw error;
  };

  return {
    approve: useMutation({
      mutationFn: async (memberId: string) =>
        raise(await supabase.rpc('approve_member', { member_id: memberId })),
      ...after,
    }),
    reject: useMutation({
      mutationFn: async (memberId: string) =>
        raise(await supabase.rpc('reject_member', { member_id: memberId })),
      ...after,
    }),
    remove: useMutation({
      mutationFn: async (memberId: string) =>
        raise(await supabase.rpc('remove_member', { member_id: memberId })),
      ...after,
    }),
    revoke: useMutation({
      mutationFn: async (invitationId: string) =>
        raise(await supabase.rpc('revoke_invitation', { invitation_id: invitationId })),
      ...after,
    }),
  };
}
