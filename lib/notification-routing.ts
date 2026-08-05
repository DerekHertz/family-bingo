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
 */

import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { pushRoute } from '../src/domain/notifications';
import { useSession } from './session';

export function useNotificationTaps(): void {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const session = useSession();

  const ready = navigationState?.key !== undefined && session !== undefined;
  // A live copy for the listener, which is registered once and must not close over the
  // session as it was at registration.
  const signedIn = session !== null && session !== undefined;

  // Whichever cold-start response is waiting, held until the two conditions above are met.
  // The effect below can run before the navigator exists, and dropping the response then
  // would mean the tap that launched the app is the one tap that does nothing.
  const handled = useRef(false);

  useEffect(() => {
    if (!ready || !signedIn || handled.current) return;

    const response = Notifications.getLastNotificationResponse();
    // Once, ever. This value survives the app being killed, so without clearing it every
    // subsequent launch would re-open the Tile from whenever the Member last tapped one.
    handled.current = true;
    Notifications.clearLastNotificationResponse();

    const route = pushRoute(response?.notification.request.content.data);
    if (route === null) return;

    router.push({
      pathname: '/board/[id]',
      params: { id: route.boardId, ...(route.tileId === undefined ? {} : { tile: route.tileId }) },
    });
  }, [ready, signedIn, router]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      // The running app has a navigator by definition, but not necessarily a session — a
      // tap arriving on the sign-in screen has nowhere to go, and pushing a Board there
      // would replace the screen the Member needs with one that cannot load.
      if (!signedIn) return;
      const route = pushRoute(response.notification.request.content.data);
      if (route === null) return;
      router.push({
        pathname: '/board/[id]',
        params: { id: route.boardId, ...(route.tileId === undefined ? {} : { tile: route.tileId }) },
      });
    });
    return () => subscription.remove();
  }, [router, signedIn]);
}
