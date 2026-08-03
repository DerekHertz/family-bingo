/**
 * The root layout: fonts, providers, and nothing else.
 *
 * Screen transitions are platform default and unstyled (FRONTEND_DESIGN §5) — the four
 * bespoke animations all live on the board, not between screens.
 */

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
import { supabase } from '../lib/supabase';
import { color } from '../theme/tokens';

// A rejection here is not worth crashing over: the splash simply hides on its own.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  // Bundled, never fetched (§8) — @expo-google-fonts ships the files and the OFL licence
  // in the package rather than pulling them at runtime.
  const [fontsLoaded, fontError] = useFonts({
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
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

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
