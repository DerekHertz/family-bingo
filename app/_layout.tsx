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
import { color } from '../theme/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Bundled, never fetched (§8) — @expo-google-fonts ships the files and the OFL licence
  // in the package rather than pulling them at runtime.
  const [fontsLoaded] = useFonts({
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

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Holding the splash rather than rendering in a fallback face: the wordmark is Shippori
  // at 38pt, and the substitution would be the first thing anyone saw.
  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}
      />
    </QueryClientProvider>
  );
}
