/**
 * The switches on the notifications screen (FRONTEND_DESIGN §4.8).
 *
 * Two tables, because the product has two scopes and they are not the same:
 *
 *   - `notification_preferences` is per **Account**. A device token hangs off an Account
 *     and a handset has one notification tray, so "tell me when a square falls" cannot
 *     have a different answer in two Families (api.md §6.1).
 *   - `members.digest_opt_in` is per **Member**, and stays there. A Digest is one Family's
 *     week (§19.1), so somebody in two Families genuinely has two answers.
 *
 * Nothing here decides who is notified or when. The trigger on `notifications` decides
 * whether a row is written and `pending_notifications()` decides when it is sent, both in
 * the database with pgTAP around them (20260801000036, §15.5).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { failedWith } from '../failure';
import { supabase } from '../supabase';

/**
 * Why a switch would not move, phrased for the Member who moved it.
 *
 * Here rather than on `app/account/notifications.tsx`, for the reason `incrementFailureCopy`
 * is in `increments.ts`: the module that owns the write owns the sentence for its refusals.
 *
 * This existed nowhere until the review. `useSetPreference` rolled its optimistic update
 * back `onError` and said nothing at all — the switch slid, sprang back, and the screen was
 * silent, which is the one failure a settings screen cannot afford, because the Member's
 * only evidence is the control moving. `useSetDigestOptIn` threw a message that nothing
 * displayed.
 *
 * Matched on the SQLSTATE through `lib/failure.ts`, never on message text: PostgREST
 * rejects with a plain object whose `code` carries the state, and the state never appears
 * in the sentence.
 *
 * Both named refusals are permanent — neither is fixed by trying again — which is why one
 * "have another go" for all of them would be advice that cannot work (§0.3).
 */
export const preferenceFailureCopy = (thrown: unknown): string => {
  // `notification_preferences_self_all` and `members_self_update` are both
  // `account_id = auth.uid()`, so this is a session that has expired underneath the screen
  // rather than a Member reaching for somebody else's row — nothing on this screen can
  // even draw a switch belonging to anyone else.
  if (failedWith(thrown, '42501')) {
    return 'You’re signed out. Sign in again and the switch will hold.';
  }
  // `quiet_window_is_not_empty` (20260801000036). Unreachable from this screen today — it
  // sends booleans and never a time — and kept for the picker §4.8 leaves room for, which
  // is exactly when a start equal to an end becomes typeable.
  if (failedWith(thrown, '23514')) {
    return 'Quiet hours need a start and an end that differ.';
  }
  return 'That didn’t save. Have another go in a moment.';
};

/** What a screen says when it could not read the switches at all. */
export const PREFERENCES_UNREADABLE = 'Couldn’t read your settings just now. Try again in a moment.';

/** And when it could read them but not the Families the Digest belongs to (§19.1). */
export const DIGEST_CHOICES_UNREADABLE = 'Couldn’t read your families just now.';

/** One row of `notification_preferences`, as the screen reads it. */
export interface NotificationPreferences {
  tileCompleted: boolean;
  bingoBlackout: boolean;
  almanac: boolean;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
}

/** Every switch this screen can turn, keyed by its column. */
export type PreferenceUpdate = Partial<{
  tile_completed: boolean;
  bingo_blackout: boolean;
  almanac: boolean;
  quiet_hours: boolean;
}>;

/**
 * Carries the Account for the reason every key in this app does: the QueryClient outlives
 * a sign-out, and `notification_preferences_self_all` returns a different row per caller.
 * `queryClient.clear()` on SIGNED_OUT is the other half of that pair.
 */
export const preferencesKey = (accountId: string) => ['notification-preferences', accountId] as const;

export function useNotificationPreferences(accountId: string | undefined) {
  return useQuery({
    queryKey: preferencesKey(accountId ?? 'anonymous'),
    enabled: accountId !== undefined,
    queryFn: async (): Promise<NotificationPreferences | null> => {
      // `maybeSingle`, not `single`: a trigger on `accounts` creates this row and the
      // migration backfilled every Account that already existed, so it is always there —
      // but `single` turns a missing row into a thrown error, and a settings screen that
      // cannot render because a row is absent is worse than one showing the defaults.
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('tile_completed, bingo_blackout, almanac, quiet_hours, quiet_start, quiet_end')
        .eq('account_id', accountId ?? '')
        .maybeSingle();
      if (error !== null) throw error;
      if (data === null) return null;

      return {
        tileCompleted: data.tile_completed as boolean,
        bingoBlackout: data.bingo_blackout as boolean,
        almanac: data.almanac as boolean,
        quietHours: data.quiet_hours as boolean,
        quietStart: data.quiet_start as string,
        quietEnd: data.quiet_end as string,
      };
    },
  });
}

/**
 * Turn one switch.
 *
 * An upsert rather than an update, and the `account_id` in the payload is what makes the
 * insert path legal: the policy's WITH CHECK refuses any row whose owner is not the caller,
 * which is also why the grant on this table is not column-scoped the way `members` is
 * (20260801000007:46). The insert path should never run — the row is seeded by a trigger —
 * but a settings screen whose only write silently affects zero rows is the failure mode
 * that is hardest to see.
 */
export function useSetPreference(accountId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (update: PreferenceUpdate): Promise<void> => {
      if (accountId === undefined) throw new Error('no account');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ account_id: accountId, ...update }, { onConflict: 'account_id' });
      if (error !== null) throw error;
    },

    /**
     * Optimistic, for the same reason logging an Increment is (§17.2): a switch that waits
     * for a round trip before moving reads as a switch that did not take, and the Member
     * flips it again.
     */
    onMutate: async (update) => {
      const key = preferencesKey(accountId ?? 'anonymous');
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationPreferences | null>(key);
      queryClient.setQueryData<NotificationPreferences | null>(key, (current) =>
        current === null || current === undefined
          ? current ?? null
          : {
              ...current,
              ...(update.tile_completed === undefined ? {} : { tileCompleted: update.tile_completed }),
              ...(update.bingo_blackout === undefined ? {} : { bingoBlackout: update.bingo_blackout }),
              ...(update.almanac === undefined ? {} : { almanac: update.almanac }),
              ...(update.quiet_hours === undefined ? {} : { quietHours: update.quiet_hours }),
            },
      );
      return { previous, key };
    },

    onError: (_error, _update, context) => {
      if (context === undefined) return;
      queryClient.setQueryData(context.key, context.previous);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: preferencesKey(accountId ?? 'anonymous') });
    },
  });
}

/** One Family's Digest choice, made by the Member the caller plays as there (§19.1). */
export interface DigestChoice {
  memberId: string;
  familyName: string;
  optedIn: boolean;
}

export const digestChoicesKey = (accountId: string) => ['digest-opt-in', accountId] as const;

/**
 * Every Family the caller is an active Member of, with their Digest answer in it.
 *
 * `.eq('account_id', …)` is load-bearing and its absence is a bug this repo has already
 * shipped once: `members_read` is Family-WIDE, so without it a six-person Family comes back
 * as six rows and the screen offers to change a stranger's preference — which the server
 * would refuse, from a switch that should never have been drawn.
 *
 * That same clause excludes Managed Members: they are backed by `guardian_account_id`, and
 * FRONTEND_DESIGN §4.7 says they receive nothing. `managed_member_takes_no_digest`
 * (20260801000011:22) says it again as a CHECK constraint, so a row for one could not be
 * written even if a screen offered it.
 */
export function useDigestChoices(accountId: string | undefined) {
  return useQuery({
    queryKey: digestChoicesKey(accountId ?? 'anonymous'),
    enabled: accountId !== undefined,
    queryFn: async (): Promise<DigestChoice[]> => {
      const { data, error } = await supabase
        .from('members')
        .select('id, digest_opt_in, joined_at, family:family_id (name)')
        .eq('account_id', accountId ?? '')
        .eq('status', 'active')
        // Join order, which is the only ordering §13.5 permits anywhere in this app.
        .order('joined_at', { ascending: true });
      if (error !== null) throw error;

      return (data ?? []).flatMap((row) => {
        const family = row.family as unknown as { name: string } | null;
        if (family === null) return [];
        return [
          {
            memberId: row.id as string,
            familyName: family.name,
            optedIn: row.digest_opt_in as boolean,
          },
        ];
      });
    },
  });
}

/**
 * §19.1's opt-in, per Member.
 *
 * `digest_opt_in` is one of the four columns `members` grants UPDATE on
 * (20260801000007:46), and the scope there is what stops this same write path being able
 * to set `role` or `family_id`. Nothing extra is needed here; the grant is the guard.
 */
export function useSetDigestOptIn(accountId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, optedIn }: { memberId: string; optedIn: boolean }) => {
      // `.select()` because `members_self_update` is a `using` policy: a refused UPDATE
      // matches no rows and PostgREST answers 204 with no error, so a switch would appear
      // to take and revert on the next read. Asking for the row back makes the refusal
      // visible — the same trap `useDeleteIncrement` documents.
      const { data, error } = await supabase
        .from('members')
        .update({ digest_opt_in: optedIn })
        .eq('id', memberId)
        .select('id');
      if (error !== null) throw error;
      // Thrown in the shape PostgREST rejects in — a plain object with a `code` — rather
      // than as an `Error`, so `preferenceFailureCopy` reads it through the same SQLSTATE
      // branch as a real refusal. It used to be `new Error('the server refused that
      // change')`, which carried no code, matched nothing, and was displayed by nobody.
      // Zero rows here IS 42501: `members_self_update` is a `using` policy, so a refusal
      // touches no rows and answers 204 rather than an error.
      if ((data ?? []).length === 0) throw { code: '42501', message: 'row not updatable' };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: digestChoicesKey(accountId ?? 'anonymous') });
    },
  });
}
