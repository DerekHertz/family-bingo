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

/** Where the provider sends the browser back to. Deep link on device, origin on web. */
const redirectTo = () => Linking.createURL('/auth/callback');

export const signInWithProvider = async (provider: Provider): Promise<void> => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  });
  if (error !== null) throw error;
  if (data.url === null) throw new Error('no authorization URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo());
  if (result.type !== 'success') return; // dismissed — not an error, and never scolded

  // The tokens come back in the URL fragment; the client is configured not to read the
  // address bar itself (detectSessionInUrl: false), so they are handed over explicitly.
  const params = new URLSearchParams(result.url.split('#')[1] ?? '');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token === null || refresh_token === null) {
    throw new Error('no session in the callback');
  }
  await supabase.auth.setSession({ access_token, refresh_token });
};

/**
 * A magic link. The only route that needs no provider configuration, which makes it the
 * one that always works — including on the first run of a fresh project.
 */
export const signInWithEmail = async (email: string): Promise<void> => {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo() },
  });
  if (error !== null) throw error;
};

export const signOut = async (): Promise<void> => {
  const { error } = await supabase.auth.signOut();
  if (error !== null) throw error;
};
