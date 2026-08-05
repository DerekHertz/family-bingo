/**
 * `device_tokens` — the one table in this slice a client may write (PRD §15.4).
 *
 * The row is addressed to an **Account**, not a Member (api.md §6.1): a token hangs off a
 * login and a handset has one notification tray, so somebody playing in two Families has
 * one row here and two Members. Everything else about notifications is the server's —
 * `notify_family()` decides who hears about a Milestone and the outbox decides when, both
 * with pgTAP around them (§15.5).
 *
 * No react-query hooks here on purpose. Registration happens in an effect at launch and in
 * one handler on the settings screen; neither reads this table back, and a query key over
 * a table whose only reader is an Edge Function would be cache for nobody.
 */

import { supabase } from '../supabase';
import { currentPushToken, type PushRegistration } from '../notifications';

/**
 * §15.4 — "refreshed on launch".
 *
 * `onConflict: 'account_id,token'` is the UNIQUE constraint the table was built with
 * (20260801000001), and the refresh is the point: `last_seen_at` moving is how a live
 * handset is told apart from one that was reinstalled onto a new token months ago. Without
 * the conflict target PostgREST resolves on the primary key instead, which is a `gen_random_uuid()`
 * that never collides — so every launch would insert a duplicate row and the Member would
 * get one push per launch they had ever made.
 *
 * `last_seen_at` is sent rather than defaulted, because the DEFAULT only applies to an
 * INSERT and this is an upsert: on the conflict path the column would keep whatever it said
 * the first time.
 */
export const registerDevice = async (
  accountId: string,
  registration: PushRegistration,
): Promise<void> => {
  const { error } = await supabase.from('device_tokens').upsert(
    {
      account_id: accountId,
      token: registration.token,
      platform: registration.platform,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,token' },
  );
  if (error !== null) throw error;
};

/** Mint whatever this handset already has permission for, and record it. */
export const registerThisDevice = async (accountId: string): Promise<void> => {
  const registration = await currentPushToken();
  // No token is not a failure (§15.3) — a simulator, or a Member who has not said yes.
  if (registration === null) return;
  await registerDevice(accountId, registration);
};

/**
 * Sign-out: this handset stops being this Account's.
 *
 * **Called before `supabase.auth.signOut()`, and it has to be.** `device_tokens_self_all`
 * is `account_id = auth.uid()`, so a delete issued after the session is gone matches
 * nothing and answers 204 — the row survives, and the next person to sign in on this phone
 * receives the previous Account's Family news. That is §8.1 breached by a handset rather
 * than by a query. The `SIGNED_OUT` event is the wrong place for the same reason: by the
 * time it fires there is no `auth.uid()` left to match on.
 *
 * Only THIS handset's token goes. A Member with a phone and a tablet is one Account with
 * two rows, and signing out of one must not silence the other.
 *
 * Failure is swallowed: signing out must not be blocked by a network call, and a token
 * that outlives its Account is pruned the first time Expo answers `DeviceNotRegistered`.
 */
export const forgetThisDevice = async (accountId: string): Promise<void> => {
  try {
    const registration = await currentPushToken();
    if (registration === null) return;
    await supabase
      .from('device_tokens')
      .delete()
      .eq('account_id', accountId)
      .eq('token', registration.token);
  } catch {
    // Nothing here is worth keeping a Member signed in for.
  }
};
