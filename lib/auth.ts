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
import { forgetThisDevice } from './queries/device-tokens';
import { supabase } from './supabase';

export type Provider = 'apple' | 'google';

/** Signing in did not fail — the Member changed their mind. §0.3: nothing scolds. */
export class SignInCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SignInCancelled';
  }
}

/**
 * The provider is not switched on for this Supabase project.
 *
 * Distinct from a failure because the answer is different: retrying never helps, and the
 * fix is in the dashboard rather than on the phone. Worth its own type so a half-configured
 * development project says something true instead of asking the Member to try again.
 */
export class ProviderNotEnabled extends Error {
  constructor(readonly provider: Provider) {
    super(`${provider} is not enabled for this project`);
    this.name = 'ProviderNotEnabled';
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
  if (error !== null) {
    if (/provider is not enabled/i.test(error.message)) throw new ProviderNotEnabled(provider);
    throw error;
  }
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

/**
 * The development sign-in — an existing Account, by address alone, with no email sent.
 *
 * Supabase's default SMTP allows two emails an hour, which is not enough to exercise
 * anything that takes two people: an Invitation, an approval, a Centre vote. This is the
 * way round it, and `supabase/functions/dev-login/index.ts` carries the warning about
 * what it is.
 *
 * `devLoginSecret` is undefined in any build that was not deliberately configured for it,
 * which is what keeps the route out of the sign-in screen and out of anyone's hands.
 */
const rawDevLoginSecret = process.env.EXPO_PUBLIC_DEV_LOGIN_SECRET;
/** `undefined` unless deliberately configured — an empty `.env` line is not a secret. */
export const devLoginSecret =
  rawDevLoginSecret === undefined || rawDevLoginSecret === '' ? undefined : rawDevLoginSecret;

/** No such Account here — a different address, or one that was never created. */
export class NoSuchAccount extends Error {
  constructor() {
    super('no account with that address');
    this.name = 'NoSuchAccount';
  }
}

/**
 * The door is not open here: not deployed, `DEV_LOGIN_SECRET` unset on the project, or
 * the secret in this build does not match the one on that project.
 *
 * All three are one message on purpose. They are the same fix — go and look at the
 * project's configuration — and the alternative is a screen that tells anyone holding the
 * anon key which of those three is true.
 */
export class DevLoginUnavailable extends Error {
  constructor() {
    super('dev sign-in is not switched on for this project');
    this.name = 'DevLoginUnavailable';
  }
}

export const signInWithoutEmail = async (email: string): Promise<void> => {
  const address = email.trim();
  if (devLoginSecret === undefined) throw new DevLoginUnavailable();

  const { data, error } = await supabase.functions.invoke<{ token_hash?: string }>(
    'dev-login',
    { body: { email: address, secret: devLoginSecret } },
  );

  // invoke() reports every non-2xx as one FunctionsHttpError, so the answers have to be
  // read back off the response body rather than off the status.
  //
  // Status alone was not enough, and the way it failed mattered: four different things
  // answer 404 — the function not deployed, `DEV_LOGIN_SECRET` unset, a wrong secret, and
  // a genuine miss — so mapping 404 to "no such account" told a developer who had
  // forgotten `supabase functions deploy` to go and burn a magic-link email. That is the
  // one outcome this whole feature exists to avoid.
  //
  // `error.context` is the untouched Response — functions-js throws before reading the
  // body — so the reason is still there to be read. `no_account` is only ever returned to
  // a caller who already passed the secret check, so distinguishing it here tells an
  // outsider nothing they could not already infer.
  if (error !== null) {
    const response = (error as { context?: unknown }).context;
    const reason =
      response instanceof Response
        ? await response
            .json()
            .then((b: { reason?: unknown }) => b.reason)
            .catch(() => null)
        : null;
    if (reason === 'no_account') throw new NoSuchAccount();
    throw new DevLoginUnavailable();
  }

  const tokenHash = data?.token_hash;
  if (typeof tokenHash !== 'string') throw new DevLoginUnavailable();

  // The same call the real magic link makes when it lands. Nothing downstream can tell
  // the two apart, which is the point: this tests the app, not a special path through it.
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (verifyError !== null) throw verifyError;
};

/**
 * Signing out, and un-registering the handset first.
 *
 * The order is the whole point. `device_tokens_self_all` is `account_id = auth.uid()`, so
 * the delete has to happen while there is still a session to match on — after
 * `auth.signOut()` it matches nothing, answers 204, and the row survives. A row that
 * survives is this phone still receiving the previous Account's Family news, which is §8.1
 * broken by a handset rather than by a query. That is also why the `SIGNED_OUT` handler in
 * `app/_layout.tsx` clears the query cache and nothing more.
 *
 * The read is best-effort: `forgetThisDevice` swallows its own failures, because nothing
 * about a network call is worth keeping a Member signed in for, and a token that outlives
 * its Account is pruned the first time Expo answers `DeviceNotRegistered` (§15.4).
 */
export const signOut = async (): Promise<void> => {
  const { data } = await supabase.auth.getSession();
  const accountId = data.session?.user.id;
  if (accountId !== undefined) await forgetThisDevice(accountId);

  const { error } = await supabase.auth.signOut();
  if (error !== null) throw error;
};
