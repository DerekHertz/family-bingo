/**
 * Where a magic link lands.
 *
 * `detectSessionInUrl` is off — there is no address bar on a phone — so the tokens have to
 * be taken out of the deep link by hand and handed to the client. Without this route the
 * third sign-in method in §4 sends an email that goes nowhere, which is how it shipped in
 * the first draft.
 *
 * Two arrival paths, and both matter: the app is already open (the URL comes through the
 * `Linking` event), or the link cold-started it (the URL is the initial one).
 */

import { Redirect, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SignInCancelled, sessionFromUrl } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { styles } from '../../theme/fonts';
import { color, space } from '../../theme/tokens';

export default function AuthCallback() {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
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
      {failed === null ? (
        <ActivityIndicator
          color={color.ink3}
          accessibilityLabel="Signing you in"
          accessibilityRole="progressbar"
        />
      ) : (
        <>
          <Text style={{ ...styles.body, color: color.ink2, textAlign: 'center' }}>{failed}</Text>
          <Text
            accessibilityRole="button"
            onPress={() => router.replace('/')}
            style={{ ...styles.body, color: color.ink, marginTop: space.lg }}
          >
            Back to sign in
          </Text>
        </>
      )}
    </View>
  );
}
