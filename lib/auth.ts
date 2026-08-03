/**
 * Signing in. Three passwordless routes, no password anywhere (FRONTEND_DESIGN §4).
 *
 * > "No passwords. Not now, not later — there's nothing to forget."
 *
 * Apple and Google go through Supabase's OAuth redirect rather than a native SDK. That is
 * a deliberate v1 choice: the redirect works identically in Expo Go, on web, and in a
 * release build, so the whole flow can be exercised before either provider is configured
 * with real credentials. Native Sign in with Apple is a later swap behind this same
 * function, not a rewrite of the screen.
 *
 * Nothing here decides who a Member is. `create_family()` and `redeem_invitation()` do
 * that (slices 2 and 3); an Account is only ever a login (CONTEXT.md, Account).
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

export type Provider = 'apple' | 'google';

/** Signing in did not fail — the Member changed their mind. §0.3: nothing scolds. */
export class SignInCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SignInCancelled';
  }
}

/** Where the provider sends the browser back to. Deep link on device, origin on web. */
export const redirectTo = () => Linking.createURL('/auth/callback');

/**
 * Pull a session out of a callback URL.
 *
 * Exported and pure so it can be tested, and because two callers need it: the in-app
 * browser returns the URL directly, and a magic link arrives through `Linking` minutes
 * later with the app cold.
 *
 * Both the fragment and the query are read. The implicit flow puts tokens in the fragment
 * and a denial in either, depending on provider — and `indexOf` rather than `split('#')[1]`
 * because a token containing `#` would otherwise be truncated.
 */
export const sessionFromUrl = (
  url: string,
): { access_token: string; refresh_token: string } | null => {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const params = new URLSearchParams(hash >= 0 ? url.slice(hash + 1) : '');
  const search = new URLSearchParams(
    query >= 0 ? url.slice(query + 1, hash >= 0 ? hash : undefined) : '',
  );

  // A refusal is a legitimate outcome, not a malformed response.
  if (params.get('error') !== null || search.get('error') !== null) throw new SignInCancelled();

  const access_token = params.get('access_token') ?? search.get('access_token');
  const refresh_token = params.get('refresh_token') ?? search.get('refresh_token');
  if (access_token === null || refresh_token === null) return null;
  return { access_token, refresh_token };
};

export const signInWithProvider = async (provider: Provider): Promise<void> => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  });
  if (error !== null) throw error;
  if (data.url === null) throw new Error('no authorization URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo());
  // Dismissed the sheet. Not a failure, and the screen must not say it was.
  if (result.type !== 'success') throw new SignInCancelled();

  const session = sessionFromUrl(result.url);
  if (session === null) throw new Error('no session in the callback');
  const { error: setError } = await supabase.auth.setSession(session);
  if (setError !== null) throw setError;
};

/**
 * A magic link. The only route that needs no provider configuration, which makes it the
 * one that always works — including on the first run of a fresh project.
 */
export const signInWithEmail = async (email: string): Promise<void> => {
  const address = email.trim();
  // Deliberately loose: the server is the authority on whether an address exists, and a
  // strict client-side pattern rejects valid addresses far more often than it helps.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error('that does not look like an email address');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error !== null) throw error;
};

export const signOut = async (): Promise<void> => {
  const { error } = await supabase.auth.signOut();
  if (error !== null) throw error;
};
