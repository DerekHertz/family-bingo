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
 * The token this process actually wrote a row for, so sign-out can delete the right one.
 *
 * Not derived again at sign-out, and that is the fix to a real breach rather than a
 * micro-optimisation. `forgetThisDevice` used to call `currentPushToken()`, which answers
 * `null` on a simulator, when permission is not *currently* granted, and when Expo's token
 * service is unreachable — and in all three it deleted nothing. The middle one is ordinary:
 * Alice registers token T, turns notifications off in iOS Settings months later, signs out,
 * and the row survives. See `device_tokens_token_key` (20260801000036) for the other half.
 *
 * Module scope, so it dies with the process — which is correct. A launch that could not
 * mint a token has no row to forget either, and the globally-unique token means the next
 * Account to sign in on this handset takes the row over rather than sitting beside it.
 */
let registeredToken: string | null = null;

/**
 * §15.4 — "refreshed on launch".
 *
 * `onConflict: 'token'`, because a push token addresses one notification tray and a tray
 * belongs to whoever is signed in now (20260801000036). The conflict target has to name a
 * unique constraint: without one PostgREST resolves on the primary key instead, which is a
 * `gen_random_uuid()` that never collides — so every launch would insert a duplicate row
 * and the Member would get one push per launch they had ever made.
 *
 * `account_id` is in the payload rather than only in the insert, so the conflict path
 * MOVES the handset. It used to conflict on `(account_id, token)`, which meant a stale row
 * from the previous Account stayed put and this one was added beside it — both live, one
 * phone, and every notification for the previous Account's Family landing on it (§8.1).
 *
 * `last_seen_at` is sent rather than defaulted, because the DEFAULT only applies to an
 * INSERT and this is an upsert: on the conflict path the column would keep whatever it said
 * the first time. It is how a live handset is told apart from one reinstalled months ago.
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
    { onConflict: 'token' },
  );
  if (error !== null) throw error;
  registeredToken = registration.token;
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
 * **The token comes from what was registered, not from minting one again.** Re-deriving it
 * was the defect: `currentPushToken()` answers `null` on a simulator, when permission is not
 * currently granted, and when Expo's service is unreachable, and in all three this deleted
 * nothing at all. The permission case is the ordinary one — turn notifications off in
 * Settings, sign out, and the row lived on for the next person to sign in on that phone.
 *
 * `currentPushToken()` remains as a fallback for the launch that never registered anything
 * in this process. It is best-effort, and it is no longer the only chance: `device_tokens`
 * makes the token itself unique now, so the next sign-in takes the row over rather than
 * adding a second one against the same handset (20260801000036).
 *
 * Failure is swallowed: signing out must not be blocked by a network call, and a token
 * that outlives its Account is pruned the first time Expo answers `DeviceNotRegistered`.
 */
export const forgetThisDevice = async (accountId: string): Promise<void> => {
  try {
    const token = registeredToken ?? (await currentPushToken())?.token ?? null;
    if (token === null) return;
    await supabase.from('device_tokens').delete().eq('account_id', accountId).eq('token', token);
    registeredToken = null;
  } catch {
    // Nothing here is worth keeping a Member signed in for.
  }
};
