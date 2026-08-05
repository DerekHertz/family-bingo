/**
 * The root layout: fonts, providers, and nothing else.
 *
 * Screen transitions are platform default and unstyled (FRONTEND_DESIGN §5) — the four
 * bespoke animations all live on the board, not between screens.
 */

import { DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { ShipporiMincho_500Medium } from '@expo-google-fonts/shippori-mincho';
import {
  ZenKakuGothicNew_400Regular,
  ZenKakuGothicNew_500Medium,
  ZenKakuGothicNew_700Bold,
} from '@expo-google-fonts/zen-kaku-gothic-new';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useNotificationTaps } from '../lib/notification-routing';
import { registerThisDevice } from '../lib/queries/device-tokens';
import { supabase } from '../lib/supabase';
import { color } from '../theme/tokens';

// A rejection here is not worth crashing over: the splash simply hides on its own.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  // Bundled, never fetched (§8) — @expo-google-fonts ships the files and the OFL licence
  // in the package rather than pulling them at runtime.
  const [fontsLoaded, fontError] = useFonts({
    DMMono_500Medium,
    ShipporiMincho_500Medium,
    ZenKakuGothicNew_400Regular,
    ZenKakuGothicNew_500Medium,
    ZenKakuGothicNew_700Bold,
  });

  // Created once per mount rather than at module scope, so a fast refresh cannot hand two
  // trees the same cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The Board and the Feed are read on every open and change rarely within a
            // session. A minute of staleness saves a round trip on every tab switch.
            staleTime: 60_000,
            retry: 2,
          },
        },
      }),
  );

  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Signing out has to empty the cache, not just the session.
  //
  // The QueryClient is created once and outlives every sign-in, so without this the next
  // Account to use the handset inherits whatever the last one fetched — Family names,
  // Members' names, eventually a Board. Keys carry the Account id as well; this is the
  // belt to that pair of braces, and it is the one that catches a key someone forgets.
  //
  // The device token is **not** removed here, and that is deliberate. `SIGNED_OUT` fires
  // after the session is gone, and `device_tokens_self_all` is `account_id = auth.uid()` —
  // so a delete issued from this handler matches nothing, answers 204, and leaves the row
  // behind for the next Account on this handset to receive news from. It is removed in
  // `signOut()` instead, before the session is torn down; see lib/queries/device-tokens.ts.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') queryClient.clear();

      // §15.4 — "device tokens refreshed on launch". `INITIAL_SESSION` is launch: it fires
      // once, with whatever was in the keychain. `SIGNED_IN` covers the magic link landing
      // minutes later on a cold app.
      //
      // Deliberately not on `TOKEN_REFRESHED`, which fires roughly hourly for the whole
      // life of the session and would turn one write per launch into one per hour.
      //
      // This never prompts. `registerThisDevice` reads a permission that already exists
      // and mints a token only if it was granted — §15.3's one-way door is opened from the
      // notifications screen and nowhere else.
      //
      // Deferred out of the callback with a zero timeout, which supabase-js asks for
      // explicitly: this handler runs inside the client's own auth lock, and a Supabase
      // call made from within it can wait on a lock the callback is holding. The symptom is
      // not an error, it is a launch that hangs — so it is worth the odd-looking line.
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session !== null) {
        const accountId = session.user.id;
        setTimeout(() => {
          void registerThisDevice(accountId).catch(() => undefined);
        }, 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  // §4.8 — a tap opens the Tile the notification is about. Both the running app and the
  // cold start, which are different code paths (lib/notification-routing.ts).
  useNotificationTaps();

  // Holding the splash rather than rendering in a fallback face: the wordmark is Shippori
  // at 38pt, and the substitution would be the first thing anyone saw.
  //
  // `fontError` is what stops that being forever. Without it a failed font load left
  // `fontsLoaded` false permanently — a blank screen under a splash that never hid, and
  // no way for the Member to tell it apart from a hang. A fallback face is a bad first
  // impression; an app that never opens is worse.
  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      {/* Not "auto": every ground in this app is `paper`, whatever the handset's scheme
          is set to, so auto puts white glyphs on cream on a dark phone. Dark mode is
          §1.2's job and is not wired up yet. */}
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}
      />
    </QueryClientProvider>
  );
}
