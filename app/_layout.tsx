/**
 * The root layout: providers, and nothing else.
 *
 * Screen transitions are platform default and unstyled (FRONTEND_DESIGN §5) — the four
 * bespoke animations all live on the board, not between screens.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { color } from '../theme/tokens';

export default function RootLayout() {
  // Created once per mount rather than at module scope, so a fast refresh does not hand
  // two trees the same cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The Board and the Feed are read on every open and change rarely within a
            // session. A minute of staleness costs nothing and saves a round trip on
            // every tab switch.
            staleTime: 60_000,
            retry: 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.paper },
        }}
      />
    </QueryClientProvider>
  );
}
