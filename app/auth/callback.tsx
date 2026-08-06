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
import { Loading } from '../../components/Screen';
import { SignInCancelled, sessionFromUrl } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { styles } from '../../theme/fonts';
import { color, space } from '../../theme/tokens';

export default function AuthCallback() {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
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
          `router.replace('/')` and not `leaveTo`, because a magic link cold-starts the app
          and there is deliberately no history to unwind to. */}
      <Text style={{ ...styles.body, color: color.ink2, textAlign: 'center' }}>{failed}</Text>
      <Text
        accessibilityRole="button"
        onPress={() => router.replace('/')}
        style={{ ...styles.body, color: color.ink, marginTop: space.lg }}
      >
        Back to sign in
      </Text>
    </View>
  );
}
