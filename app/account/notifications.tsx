/**
 * Notifications — Slice 15 (PRD §15, FRONTEND_DESIGN §4.8).
 *
 * §4.6 puts this under an Account screen ("Families → people you look after → this
 * handset"). That screen does not exist yet and belongs to another slice, so this is its
 * own route for now and will move under it unchanged.
 *
 * Three rules from §4.8 shape everything below, and none of them is stylistic:
 *
 *   - **There is no daily reminder** — not off by default, *absent*, and this screen says
 *     so out loud (§7.11: no reminder, nudge or re-engagement push, in any form, under any
 *     name). The sentence is `NO_REMINDERS` and it is the last thing on the page.
 *   - **Every string names the Member and the thing.** Never "someone in your family".
 *   - **Never count what the reader hasn't done**, never name a Member who hasn't logged,
 *     never end on a question, never say anything about the reader's own inactivity.
 *
 * The switches describe **what would be sent**, not what this handset happens to be able
 * to show. That separation is the honest one: whether the phone displays anything is an OS
 * permission, it is stated once at the top, and it is not a fourth switch pretending to be
 * a preference. A Member who declines the system dialogue keeps the preferences they chose
 * — §15.3 forbids treating a decline as a failure, and it is a one-way door, so nothing
 * here asks twice.
 *
 * No colour is introduced (§1.1). An "on" switch is `ink`, exactly as `<Button variant="filled">`
 * is: moss is growth's colour and a preference has not grown anything.
 */

import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { leaveTo } from '../../lib/leave';
import { askForPush, pushPermission } from '../../lib/notifications';
import { registerDevice } from '../../lib/queries/device-tokens';
import {
  useDigestChoices,
  useNotificationPreferences,
  useSetDigestOptIn,
  useSetPreference,
  type PreferenceUpdate,
} from '../../lib/queries/notification-preferences';
import { useSession } from '../../lib/session';
import {
  DIGEST_DETAIL,
  MANAGED_MEMBERS_HEAR_NOTHING,
  NOTIFICATION_SWITCHES,
  NO_REMINDERS,
  quietHoursDetail,
} from '../../src/domain/notifications';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/**
 * One row: a name, a sentence, and a switch.
 *
 * The two Texts are hidden from the accessibility tree and carried on the Switch instead,
 * as label and hint. A container `accessible` would collapse the subtree and take the
 * control's own state with it on iOS; leaving all three visible reads the row out three
 * times. This is the pattern the drafting table's pip strip already uses.
 */
function SwitchRow({
  title,
  detail,
  value,
  onValueChange,
  disabled = false,
}: {
  title: string;
  detail: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        minHeight: size.minTouch,
        borderTopWidth: 1,
        borderTopColor: color.hairline,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1 }}
      >
        <Text style={{ ...styles.body, color: color.ink }}>{title}</Text>
        <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        accessibilityHint={detail}
        // §1.1: no state colours exist in this palette. `ink` on, `hairline` off — the same
        // pair a filled Button uses, and never `moss`, which belongs to the growth ladder.
        trackColor={{ false: color.hairline, true: color.ink }}
        thumbColor={color.paper}
        ios_backgroundColor={color.hairline}
      />
    </View>
  );
}

export default function NotificationSettings() {
  const session = useSession();
  const accountId = session?.user.id;
  const preferences = useNotificationPreferences(accountId);
  const setPreference = useSetPreference(accountId);
  const digests = useDigestChoices(accountId);
  const setDigest = useSetDigestOptIn(accountId);

  // Whether this handset may show anything at all. `undefined` while it is being read —
  // rendering "you have notifications switched off" for one frame at every open would be a
  // sentence that is usually false.
  const [permission, setPermission] = useState<'granted' | 'askable' | 'closed' | undefined>(
    undefined,
  );
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    void pushPermission().then((answer) => {
      if (live) setPermission(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * §15.3's one-way door, opened here and nowhere else in the app.
   *
   * A decline is not an error and is not reported as one: the answer is simply re-read, and
   * the line above the switches changes to say where the setting now lives. Nothing asks
   * again — on iOS the system dialogue appears once, ever.
   */
  const allow = async () => {
    if (accountId === undefined) return;
    setAsking(true);
    try {
      const registration = await askForPush();
      if (registration === null) {
        setPermission(await pushPermission());
        return;
      }
      await registerDevice(accountId, registration);
      setPermission('granted');
    } catch {
      // A token that could not be stored is a phone that hears nothing yet. The Member has
      // already granted permission, and the launch registration in app/_layout.tsx will
      // record it the next time the app opens — so there is nothing here to ask them to do.
      setPermission(await pushPermission());
    } finally {
      setAsking(false);
    }
  };

  // Nothing here belongs to nobody. Without this the query stays disabled and `isPending`
  // is true forever, so a signed-out arrival — a deep link, a web reload — would spin on a
  // spinner rather than being sent somewhere it can act.
  if (session === null) return <Redirect href="/" />;

  if (session === undefined || preferences.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your notification settings"
        />
      </View>
    );
  }

  const chosen = preferences.data;
  const update = (change: PreferenceUpdate) => setPreference.mutate(change);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{
        padding: space.xl,
        paddingTop: size.screenTop,
        paddingBottom: space.xxl,
      }}
    >
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        Notifications
      </Text>

      {preferences.isError || chosen === null || chosen === undefined ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>
          Couldn&rsquo;t read your settings just now. Try again in a moment.
        </Text>
      ) : (
        <>
          {/* This handset's permission, stated once and never as a switch. */}
          {permission === 'askable' ? (
            <View
              style={{
                marginTop: space.lg,
                padding: space.md,
                backgroundColor: color.paperRaised,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: color.hairline,
              }}
            >
              <Text style={{ ...styles.body, color: color.ink }}>
                This phone isn&rsquo;t showing notifications yet.
              </Text>
              <Button
                label={asking ? 'Asking…' : 'Let it show them'}
                variant="outlined"
                disabled={asking}
                style={{ marginTop: space.md }}
                onPress={() => void allow()}
              />
            </View>
          ) : permission === 'closed' ? (
            // No red, and nothing that reads as a scold (§1.1, §0.3). A fact and where the
            // answer lives, which is not here.
            <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>
              This phone isn&rsquo;t showing notifications. That one is set in the phone&rsquo;s own
              settings — the choices below still hold for whenever it is.
            </Text>
          ) : null}

          <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xl }}>
            What gets sent
          </Text>

          {NOTIFICATION_SWITCHES.map((item) => (
            <SwitchRow
              key={item.id}
              title={item.title}
              detail={item.detail}
              value={chosen[
                item.id === 'tile_completed'
                  ? 'tileCompleted'
                  : item.id === 'bingo_blackout'
                    ? 'bingoBlackout'
                    : 'almanac'
              ]}
              onValueChange={(next) => update({ [item.id]: next })}
            />
          ))}

          <SwitchRow
            title="Quiet hours"
            detail={quietHoursDetail(chosen.quietStart, chosen.quietEnd)}
            value={chosen.quietHours}
            onValueChange={(next) => update({ quiet_hours: next })}
          />

          {/* §19.1's Digest is per Family, not per Account: it is one Family's week, so
              somebody in two Families genuinely has two answers. Managed Members never
              appear here — the query reads the caller's own Member row in each Family, and
              a Managed Member is backed by a Guardian rather than by an Account (§4.7). */}
          <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xl }}>
            The weekly digest
          </Text>

          {digests.isPending ? (
            <ActivityIndicator
              color={color.ink3}
              accessibilityRole="progressbar"
              accessibilityLabel="Loading your families"
              style={{ marginTop: space.md, alignSelf: 'flex-start' }}
            />
          ) : digests.isError ? (
            <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
              Couldn&rsquo;t read your families just now.
            </Text>
          ) : (digests.data ?? []).length === 0 ? (
            <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
              Nothing to summarise yet — this arrives once you&rsquo;re in a Family.
            </Text>
          ) : (
            (digests.data ?? []).map((choice) => (
              <SwitchRow
                key={choice.memberId}
                title={choice.familyName}
                detail={DIGEST_DETAIL}
                value={choice.optedIn}
                onValueChange={(next) =>
                  setDigest.mutate({ memberId: choice.memberId, optedIn: next })
                }
              />
            ))
          )}

          {/* §4.8, and it has to be on the screen rather than merely true of the code. */}
          <Text style={{ ...styles.body, color: color.ink2, marginTop: space.xl }}>
            {NO_REMINDERS}
          </Text>
          <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
            {MANAGED_MEMBERS_HEAR_NOTHING}
          </Text>
        </>
      )}

      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        onPress={() => leaveTo('/home')}
      />
    </ScrollView>
  );
}
