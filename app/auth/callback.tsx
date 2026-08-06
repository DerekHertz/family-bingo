/**
 * Where a sign-in lands — and it lands two completely different ways.
 *
 * **On a device**, `detectSessionInUrl` is off because there is no address bar, so the
 * tokens have to be taken out of the deep link by hand and handed to the client. Two
 * arrival paths, both of which matter: the app is already open (the URL comes through the
 * `Linking` event), or the link cold-started it (the URL is the initial one).
 *
 * **In a browser**, none of that applies and doing it anyway is what broke sign-in. Web
 * uses PKCE, so the provider returns `?code=…` rather than tokens, and supabase-js
 * exchanges it itself on load — that is what `detectSessionInUrl` is. The hand-parser
 * looked for an `access_token`, found none, returned, and the screen sat on its spinner
 * forever while the session landed behind it. Pressing Back revealed a signed-in app,
 * which is a strange thing to ask anyone to discover.
 *
 * So on web this route waits for the session rather than making it, and gets out of the
 * way the moment it appears.
 */

import { Redirect, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Screen';
import { SignInCancelled, sessionFromUrl } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { styles } from '../../theme/fonts';
import { color, size, space } from '../../theme/tokens';

/**
 * Whether this callback is the invite-only gate turning somebody away.
 *
 * `handle_new_account()` (`20260801000037`) raises `42501` when the address is not on
 * `signup_allowlist`, inside the same transaction as the `auth.users` insert — so GoTrue
 * never finishes creating the identity and redirects back with an error rather than a
 * session. There is no session, no half-made Account and nothing to retry, which is exactly
 * why the screen must not offer a retry (§0.3).
 *
 * **Matched loosely, on purpose.** GoTrue does not forward the trigger's own message: what
 * comes back is `error_code=unexpected_failure` with a description of "Database error saving
 * new user", and that wording is GoTrue's rather than this project's — it can change with a
 * platform upgrade. So either signal is enough, and the failure mode of a false positive is
 * mild: somebody whose sign-in broke for an unrelated server reason is told sign-up is
 * invite-only and offered the demo, which is true and useful either way.
 *
 * `sessionFromUrl` cannot answer this. It throws `SignInCancelled` for *any* `error`
 * parameter — right for a provider sheet somebody backed out of, and wrong here, where
 * "no problem, nothing was signed in" would be the app shrugging at the one refusal it
 * knows the reason for. `lib/auth.ts` is deliberately not changed for this: parsing a
 * refusal is this screen's job, and the two callers of `sessionFromUrl` that are not this
 * screen have no use for it.
 */
const isInviteOnlyRefusal = (url: string): boolean => {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  // Both halves, like `sessionFromUrl`: the implicit flow puts a denial in the fragment and
  // PKCE puts it in the query, and which one arrives depends on the provider.
  const params = new URLSearchParams(hash >= 0 ? url.slice(hash + 1) : '');
  const search = new URLSearchParams(
    query >= 0 ? url.slice(query + 1, hash >= 0 ? hash : undefined) : '',
  );
  const read = (key: string) => (params.get(key) ?? search.get(key) ?? '').toLowerCase();

  if (read('error') === '') return false;
  return (
    read('error_code') === 'unexpected_failure' ||
    read('error_description').includes('database error') ||
    read('error_description').includes('invite')
  );
};

export default function AuthCallback() {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [inviteOnly, setInviteOnly] = useState(false);
  const [done, setDone] = useState(false);

  /**
   * The web half: watch for the session supabase-js is already fetching.
   *
   * `getSession()` covers the case where the exchange finished before this screen mounted,
   * and the subscription covers the case where it has not — which of the two wins is a
   * race nobody should be relying on, so both are handled.
   *
   * The failure branch matters as much as the success one. A refused sign-in — an address
   * that is not on the invite list — comes back as `?error=…` in the URL, and without this
   * the screen would spin on that too, which is the worst possible answer to "am I allowed
   * in?" (§0.3).
   */
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;

    const url = new URL(globalThis.location?.href ?? 'https://localhost');
    const refusal =
      url.searchParams.get('error_description') ?? url.searchParams.get('error');
    if (refusal !== null) {
      setFailed(
        /not on the invite list|Database error/i.test(refusal)
          ? 'Family Bingo is invite-only just now. Ask whoever sent you the link to add ' +
            'this address, and try again.'
          : 'That sign-in didn’t complete. Try again in a moment.',
      );
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session !== null) setDone(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session !== null) setDone(true);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    const consume = async (url: string | null) => {
      if (url === null || cancelled) return;
      // Before `sessionFromUrl`, which collapses every refusal into one.
      if (isInviteOnlyRefusal(url)) {
        setInviteOnly(true);
        setFailed(
          'Sign-up here is invite-only, so that address was turned away. Nothing was created.',
        );
        return;
      }
      try {
        const session = sessionFromUrl(url);
        if (session === null) return;
        const { error } = await supabase.auth.setSession(session);
        if (error !== null) throw error;
        if (!cancelled) setDone(true);
      } catch (e) {
        if (cancelled) return;
        setFailed(
          e instanceof SignInCancelled
            ? 'No problem — nothing was signed in.'
            : 'That link has already been used, or it expired. Ask for a fresh one.',
        );
      }
    };

    void Linking.getInitialURL().then(consume);
    const subscription = Linking.addEventListener('url', ({ url }) => void consume(url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  if (done) return <Redirect href="/home" />;
  if (failed === null) return <Loading what="Signing you in" />;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.paper,
        padding: space.xl,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Not `<Trouble>`: this is the whole screen rather than a line beside a form, and
          it carries its own way out. Not `<ErrorState>` either — the exit here is
          `router.replace` and not `leaveTo`, because a magic link cold-starts the app and
          there is deliberately no history to unwind to. */}
      <Text
        style={{
          ...styles.body,
          color: color.ink2,
          textAlign: 'center',
          maxWidth: size.proseWidth,
        }}
      >
        {failed}
      </Text>

      {/* **The dead end this screen used to be.**
          Being refused by the invite gate is the one failure here that cannot be retried —
          the address is not on the list and no amount of trying again puts it there — so a
          screen offering only "back to sign in" sends somebody round a loop that has no
          exit. The demo is the door that *is* open, and this is the moment it is worth
          most: they came here wanting to see the thing. */}
      {!inviteOnly ? null : (
        <Button
          label="See a demo instead"
          variant="filled"
          onPress={() => router.replace('/demo')}
          accessibilityHint="Opens a family's finished year, which you can read but not change"
          style={{ marginTop: space.lg, minWidth: size.formWidth }}
        />
      )}

      <Text
        accessibilityRole="button"
        onPress={() => router.replace(inviteOnly ? '/' : '/signin')}
        style={{ ...styles.body, color: color.ink, marginTop: space.lg }}
      >
        {inviteOnly ? 'Read about it first' : 'Back to sign in'}
      </Text>
    </View>
  );
}
