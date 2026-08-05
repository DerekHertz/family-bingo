/**
 * The permission, the token, and the Android channel (PRD §15.4).
 *
 * > `expo-notifications` over APNs + FCM. Device tokens in `device_tokens`, refreshed on
 * > launch, pruned on delivery failure.
 *
 * ---------------------------------------------------------------------------------
 * Where the ask lives, and why it is not on launch
 * ---------------------------------------------------------------------------------
 *
 * §15.3 calls notification permission **a one-way door**: once someone turns it off at the
 * OS level the app can never win them back. So there are two entry points here and only
 * one of them prompts.
 *
 * `currentPushToken()` runs on every launch and **never asks**. It reads the permission
 * that already exists and, if it is granted, mints the token. That is all §15.4's "refreshed
 * on launch" needs: a token rotates, and a Member who said yes in January must not be asked
 * again in June to keep receiving what they already agreed to.
 *
 * `askForPush()` is the door, and it is opened from exactly one place: the notifications
 * screen, when a Member turns a switch on. That is the moment the ask is earned — they have
 * navigated to a screen about notifications, read three sentences saying precisely what
 * will be sent, and reached for one. Three alternatives were considered and rejected:
 *
 *   - **First launch.** The dialogue arrives before the Member has a Family, a Board or a
 *     single thing anyone could tell them about. It is the ask most likely to be refused
 *     and the refusal is permanent.
 *   - **After the first Increment.** Better — they are playing — but the ask lands on top
 *     of the one-tap flow §11.1 exists to keep uninterrupted, and it would mean a system
 *     dialogue over the celebration in §5.
 *   - **On joining a Family.** Closest, but nothing has happened yet: the first thing the
 *     Member would be asked to accept is a stream of news about people whose names they
 *     have not seen.
 *
 * ---------------------------------------------------------------------------------
 * Not getting a token is not an error
 * ---------------------------------------------------------------------------------
 *
 * A simulator has no push service, a Member may have declined, and a build without the EAS
 * project id cannot address Expo's service. All three answer `null` and none of them is a
 * failure state — §15.3 forbids treating a declined permission as one, and the Edge
 * Function agrees on the other side: an Account with no registered device is marked sent
 * rather than retried.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * A push that arrives while the app is open still has to be seen.
 *
 * `expo-notifications` documents the default plainly: **with no handler set, an incoming
 * notification is not shown.** Nothing called `setNotificationHandler`, so PRD §15's
 * acceptance test — "they receive a push notification within 30 seconds" — failed outright
 * for any recipient who happened to have the app open. That is the common case for a family
 * playing together and the first thing anybody testing this would try.
 *
 * Module scope on purpose: the handler has to be registered before a notification can
 * arrive, and this module is imported by the launch registration in `app/_layout.tsx`.
 *
 * `shouldPlaySound: false` keeps the same promise the Android channel makes with
 * `AndroidImportance.DEFAULT`: everything here is somebody else's good news (§15.1), which
 * is worth a banner and is not worth interrupting whatever the Member is doing. No badge
 * either — a count of unread family news would be counting, and §4.8 forbids the app
 * counting anything at somebody.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** A registered handset, in the shape `device_tokens` stores. */
export interface PushRegistration {
  token: string;
  platform: 'ios' | 'android';
}

/**
 * Android delivers nothing until a channel exists.
 *
 * Not a detail: on Android 8 and later a notification posted to a missing channel is
 * dropped by the system with no error anywhere, so the whole feature is silently dead on
 * half the handsets. Created before any token is minted, and idempotent — calling it twice
 * updates the channel rather than adding a second one.
 *
 * `DEFAULT` importance rather than `HIGH`: everything this app sends is somebody else's
 * good news (§15.1), which is worth a notification and is not worth a heads-up banner over
 * whatever the Member is doing.
 */
export const ensureAndroidChannel = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Family news',
    importance: Notifications.AndroidImportance.DEFAULT,
    // No colour. §1.1: the palette has no notification accent and a stray hex here would
    // be the app's first one.
    sound: 'default',
  });
};

/**
 * The EAS project id `getExpoPushTokenAsync` needs.
 *
 * Read from the manifest rather than written here twice. It lives in `app.json` under
 * `extra.eas.projectId`, and expo-constants exposes it at two paths depending on how the
 * app was started — `easConfig` in a build, `expoConfig.extra` under Expo Go — so both are
 * tried before giving up. Absent means this build cannot mint a token, which is a `null`
 * and not a throw.
 */
const projectId = (): string | undefined => {
  const fromEas = Constants.easConfig?.projectId;
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromEas ?? fromExtra;
};

const mintToken = async (): Promise<PushRegistration | null> => {
  const id = projectId();
  if (id === undefined) return null;

  await ensureAndroidChannel();

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    // Only the two platforms `device_tokens.platform` accepts. Web has no APNs or FCM
    // route here and would be refused by the CHECK constraint (20260801000001).
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
    return { token: data, platform: Platform.OS };
  } catch {
    // Expo's service is unreachable, or this build has no push entitlement. Neither is
    // something a Member can act on, and neither costs them anything: the outbox marks a
    // row for an Account with no device as sent rather than retrying it.
    return null;
  }
};

/**
 * The token this handset already has permission for — asking nobody anything.
 *
 * Called on every launch (§15.4). `isDevice` is the guard that matters: a simulator or an
 * emulator has no push service, `getExpoPushTokenAsync` rejects there, and a Member with no
 * token is exactly what an Account with notifications off looks like.
 */
export const currentPushToken = async (): Promise<PushRegistration | null> => {
  if (!Device.isDevice) return null;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return null;
  return mintToken();
};

/**
 * The one-way door, opened deliberately (§15.3).
 *
 * Answers `null` when the Member declines, which is an ordinary outcome and never an error
 * — the caller turns its switch back off and says nothing about it.
 *
 * `getPermissionsAsync` first, because `requestPermissionsAsync` on a permission already
 * decided returns the standing answer without showing anything: on iOS the system dialogue
 * appears once, ever, and after that a "no" can only be changed in Settings.
 */
export const askForPush = async (): Promise<PushRegistration | null> => {
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  const decided = existing.granted
    ? existing
    : existing.canAskAgain
      ? await Notifications.requestPermissionsAsync()
      : existing;

  if (!decided.granted) return null;
  return mintToken();
};

/**
 * Whether this handset can still be asked.
 *
 * The screen needs the difference: a Member who has never been asked sees a switch, and a
 * Member who declined at the OS level sees a plain sentence telling them where the answer
 * now lives. Offering the same switch to both would be a control that cannot work (§0.3).
 */
export const pushPermission = async (): Promise<'granted' | 'askable' | 'closed'> => {
  if (!Device.isDevice) return 'closed';
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  return granted ? 'granted' : canAskAgain ? 'askable' : 'closed';
};
