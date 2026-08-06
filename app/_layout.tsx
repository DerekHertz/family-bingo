/**
 * The root layout: fonts, providers, and nothing else.
 *
 * Screen transitions are platform default and unstyled (FRONTEND_DESIGN §5) — the four
 * bespoke animations all live on the board, not between screens.
 */

import { QueryClient, focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useNotificationTaps } from '../lib/notification-routing';
import { PhoneShell } from '../components/PhoneShell';
import { persistOptions, persister } from '../lib/persist';
import { clearQueue, useQueueDrain } from '../lib/queue';
import { registerThisDevice } from '../lib/queries/device-tokens';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { color } from '../theme/tokens';

// A rejection here is not worth crashing over: the splash simply hides on its own.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Tell react-query what "focused" means on a handset.
 *
 * **`refetchOnWindowFocus` is on by default and was inert in this app**, because
 * react-query's built-in listener binds `visibilitychange` on `window` — which React
 * Native does not have. So every `refetchOnWindowFocus` in the codebase was a setting with
 * nothing behind it, and the only thing that ever refetched on a return was `staleTime`
 * expiring under whatever the next render asked for.
 *
 * Slice 16 is where that stopped being merely wasteful. `useSignedPhotos` re-signs on an
 * interval and its comment said "the refetch on foreground covers the return" — there was
 * no such refetch, and iOS suspends timers in the background, so a Feed left open while a
 * phone went in a pocket for ten minutes came back to a screen of hatch placeholders with
 * nothing scheduled to fix them. Every URL on it had expired (§16.2's five minutes) and
 * the interval that would have replaced them had not run.
 *
 * Registered at module scope rather than in an effect: the manager is a singleton, this is
 * a fact about the platform rather than about any tree, and a re-register on fast refresh
 * would swap the listener out from under itself.
 */
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => {
      // `active` only. `inactive` is the app switcher and an incoming call, and treating
      // that as a blur would refetch every time a Member glanced at Control Centre.
      setFocused(state === 'active');
    });
    return () => subscription.remove();
  });
}

export default function RootLayout() {
  /**
   * Bundled, never fetched (§8) — and loaded from `assets/fonts/` rather than from the
   * `@expo-google-fonts` packages, which is not a style preference.
   *
   * Importing the faces from those packages makes Expo emit them at
   * `/assets/node_modules/@expo-google-fonts/…`, and **Cloudflare Pages refuses to upload
   * anything under a `node_modules` path.** The deploy succeeds, every asset reference in
   * the bundle 404s, the SPA fallback answers each one with `index.html`, and the app
   * renders in system fallback faces — on a product whose §1 is a type scale. Nothing
   * fails: it just quietly stops being the design.
   *
   * Vendoring the five files the app actually uses puts them under `assets/fonts/`, which
   * has no reserved segment in it. It also makes the dependency legible — five faces, not
   * three packages of thirty — and the OFL licence sits beside them, which §8 requires
   * shipping anyway.
   */
  const [fontsLoaded, fontError] = useFonts({
    DMMono_500Medium: require('../assets/fonts/DMMono_500Medium.ttf'),
    ShipporiMincho_500Medium: require('../assets/fonts/ShipporiMincho_500Medium.ttf'),
    ZenKakuGothicNew_400Regular: require('../assets/fonts/ZenKakuGothicNew_400Regular.ttf'),
    ZenKakuGothicNew_500Medium: require('../assets/fonts/ZenKakuGothicNew_500Medium.ttf'),
    ZenKakuGothicNew_700Bold: require('../assets/fonts/ZenKakuGothicNew_700Bold.ttf'),
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
  // Signing out is a four-part job, and every part of it is somebody else's data.
  //
  //   - `clear()` empties the QueryClient in memory, as it always did.
  //   - `removeClient()` deletes the persisted copy (§17.5). Without it the file survives
  //     the sign-out and is restored on the next launch: keyed by the previous Account, so
  //     unreadable by the new one and undeletable by anyone — a Family's Board sitting on a
  //     handset that has been handed to somebody else. "Keyed so it cannot be read" was a
  //     sufficient control while the cache lived in a heap that died with the process. It
  //     is not a sufficient control for a file.
  //   - `clearQueue()` drops taps that have not drained. They belong to a Member the
  //     signed-out Account acted for, and there is no session left to send them under;
  //     replaying them under the next Account's token is the one thing they must never do.
  //     RLS would refuse it, but a queue that depends on RLS to refuse it is a queue that
  //     is trying.
  //   - The device token is **not** removed here, and that is deliberate. `SIGNED_OUT`
  //     fires after the session is gone, and `device_tokens_self_all` is
  //     `account_id = auth.uid()` — so a delete issued from this handler matches nothing,
  //     answers 204, and leaves the row behind for the next Account on this handset to
  //     receive news from. It is removed in `signOut()` instead, before the session is torn
  //     down; see lib/queries/device-tokens.ts.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        void persister.removeClient();
        void clearQueue();
      }

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
    /**
     * §17.5 — "Board and Feed cached read-only so the app opens to content rather than a
     * spinner."
     *
     * react-query's first-party persistence, restoring from AsyncStorage before the first
     * render and writing back as queries settle. **What is allowed on the disk is an
     * allowlist**, not the whole cache — `lib/persist-policy.ts` holds it and says why,
     * and the line that matters most is that a signed URL for a photograph of a child is
     * never one of them (§7.6).
     *
     * Everything restored is still refetched: `staleTime` is a minute, so a Board from
     * this morning is what the Member sees for the moment before the server answers, and
     * never instead of the answer.
     */
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {/* Not "auto": every ground in this app is `paper`, whatever the handset's scheme
          is set to, so auto puts white glyphs on cream on a dark phone. Dark mode is
          §1.2's job and is not wired up yet. */}
      <StatusBar style="dark" />
      <Drain />
      {/* Phone-shaped on a screen that is not one (§0's "Platform: Expo (iOS + Android)").
          Renders its children untouched on a device — see the component. */}
      <PhoneShell>
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}
        />
      </PhoneShell>
    </PersistQueryClientProvider>
  );
}

/**
 * The offline queue's two triggers (§17.3), mounted where they can reach the QueryClient.
 *
 * Renders nothing. It exists because `useQueueDrain` invalidates the four keys an
 * Increment moves once a drain lands anything, and `useQueryClient` only works inside the
 * provider — putting the hook in `RootLayout` would read the client from outside its own
 * tree. `useQueueDrain` itself explains why launch and foreground are the two moments, and
 * why this is not a connectivity listener.
 */
function Drain() {
  const session = useSession();
  useQueueDrain(session != null);
  return null;
}
