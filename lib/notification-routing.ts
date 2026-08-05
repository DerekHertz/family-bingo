/**
 * A tap opens the Tile the notification is about, not the app (FRONTEND_DESIGN §4.8).
 *
 * There are **two** paths here and they are different code, which is why this is one hook
 * rather than one listener:
 *
 *   - **The app is running** (foreground or backgrounded). `addNotificationResponseReceivedListener`
 *     fires with the response.
 *   - **The app was not running** and the tap launched it. No listener exists yet at the
 *     moment the OS delivers the response, so nothing fires — the response is waiting to be
 *     *asked for*, with `getLastNotificationResponse()`. This is the path that gets
 *     forgotten, and forgetting it means the notification works perfectly in every test
 *     where somebody already had the app open.
 *
 * Two things have to be true before either can navigate:
 *
 *   - **The root navigator is mounted.** `router.push` before that throws, and the cold
 *     start is precisely the case where the tap is handled first. `useRootNavigationState()`
 *     answers with a `key` once there is a tree to push onto.
 *   - **There is a session.** `boards_read` is Family-scoped, so a signed-out handset
 *     following a months-old notification would land on a Board it cannot read and see an
 *     error rather than the front door. `undefined` means the keychain is still being read
 *     and the tap waits; `null` means there is nobody to route for and it is dropped.
 *
 * ---------------------------------------------------------------------------------
 * The two paths share one guard, and it is the response's own identifier
 * ---------------------------------------------------------------------------------
 *
 * Both can fire for the same tap. `ready` and `signedIn` resolve independently, so a launch
 * response can reach the listener and navigate, and then `ready` arrives and the first
 * effect reads that same response — still uncleared — and navigates again: two
 * `/board/[id]` screens stacked on one tap. A `handled` boolean did not close that, because
 * only the first path ever set it.
 *
 * So the guard is `request.identifier`, held in a ref and checked by both. (The comment
 * this replaces claimed the listener was "registered once and must not close over the
 * session". It was never registered once — `signedIn` is in its dependency array, so it
 * re-registers on every session change, which is exactly what opens the window above.)
 */

import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { pushRoute } from '../src/domain/notifications';
import { useSession } from './session';

export function useNotificationTaps(): void {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const session = useSession();

  const ready = navigationState?.key !== undefined && session !== undefined;
  const signedIn = session !== null && session !== undefined;

  /**
   * The identifier of the response already acted on, shared by both paths.
   *
   * Remembered rather than merely counted, because the cold-start response survives the app
   * being killed: without both this and the clear below, every launch would re-open the
   * Tile from whenever the Member last tapped one.
   */
  const handled = useRef<string | null>(null);

  const follow = useCallback(
    (response: Notifications.NotificationResponse | null) => {
      if (response === null) return;
      const { identifier } = response.notification.request;
      if (handled.current === identifier) return;
      handled.current = identifier;

      const route = pushRoute(response.notification.request.content.data);
      if (route === null) return;

      router.push({
        pathname: '/board/[id]',
        params: { id: route.boardId, ...(route.tileId === undefined ? {} : { tile: route.tileId }) },
      });
    },
    [router],
  );

  useEffect(() => {
    // `getLastNotificationResponse` and `clearLastNotificationResponse` both throw
    // `UnavailabilityError` on web, and this hook runs from the root layout — so unguarded
    // they fire on every signed-in web session. `expo start --web` is a surface this repo
    // keeps working on purpose (`lib/supabase.ts` and `lib/leave.ts` both reason about it),
    // and a push tap is something web cannot deliver at all.
    if (Platform.OS === 'web') return;
    if (!ready || !signedIn) return;

    follow(Notifications.getLastNotificationResponse());
    // Once, ever. This value survives the app being killed, so leaving it would mean every
    // subsequent launch re-opening the same Tile.
    Notifications.clearLastNotificationResponse();
  }, [ready, signedIn, follow]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      // The running app has a navigator by definition, but not necessarily a session — a
      // tap arriving on the sign-in screen has nowhere to go, and pushing a Board there
      // would replace the screen the Member needs with one that cannot load. This is why
      // the listener re-registers on every session change.
      if (!signedIn) return;
      follow(response);
    });
    return () => subscription.remove();
  }, [signedIn, follow]);
}
