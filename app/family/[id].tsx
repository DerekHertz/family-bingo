/**
 * The Family's roster — Slice 3 (PRD §3, FRONTEND_DESIGN §4.5).
 *
 * The Organizer's screen: mint a code, see who is in, let in who is waiting. For everyone
 * else it is just the roster, because §3.3 makes approving an Organizer's job alone.
 *
 * Deliberately absent: any red, any "pending" badge, any resend nag (§4.5, §1.1). Someone
 * who has not been let in yet is a hairline ring at 75% and the word "invited".
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { SeatPips } from '../../components/SeatPips';
import { useFamilies } from '../../lib/queries/families';
import {
  SEATS,
  useCreateInvitation,
  useRoster,
  useRosterActions,
} from '../../lib/queries/invitations';
import { useSession } from '../../lib/session';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

export default function FamilyRoster() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const families = useFamilies(session?.user.id);
  const roster = useRoster(id);
  const invite = useCreateInvitation(id ?? '');
  const actions = useRosterActions(id ?? '');
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const say = (message: string) => {
    setTrouble(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const family = families.data?.find((f) => f.id === id);
  const isOrganizer = family?.member.role === 'organizer';
  const members = roster.data?.members ?? [];
  const open = roster.data?.invitations ?? [];
  // An outstanding invitation holds a seat: §4.5 says a code already sent is a promise,
  // and the server reserved it when it minted. Seats are only honest to an Organizer,
  // though — invitations_organizer_read denies everyone else, so `open` is empty for a
  // plain Member and a pip row built from it would claim free seats the server will refuse.
  const canCount = roster.data?.canSeeInvitations === true;
  const taken = members.length + open.length;
  const full = taken >= SEATS;

  if (roster.isPending || families.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading the roster"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop }}
    >
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        {family?.name ?? 'Family'}
      </Text>

      {canCount ? (
        <View style={{ marginTop: space.lg }}>
          <SeatPips taken={taken} total={SEATS} />
        </View>
      ) : null}

      {/* The code, once minted. It comes back from the RPC and is stored only as a hash, so
          leaving this screen loses it — minting another is cheap and is the only recovery. */}
      {code === null ? null : (
        <View
          style={{
            marginTop: space.lg,
            padding: space.lg,
            backgroundColor: color.paperRaised,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: color.hairline,
            alignItems: 'center',
          }}
        >
          <Text
            // Spelled out for a screen reader: eight characters read as a word are
            // unrepeatable, and this one gets read aloud across a room (§4.5).
            accessibilityLabel={`Invitation code: ${[...code.code].join(' ')}`}
            style={{
              // DM Mono, per §4.5. A serif is the wrong tool for eight characters read
              // aloud across a room.
              ...styles.code,
              // At capacity the card dims but stays legible — it is how the Members who
              // are already here arrived (§4.5).
              color: full ? color.ink3 : color.ink,
            }}
          >
            {code.code}
          </Text>
          <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.sm }}>
            Expires {new Date(code.expires_at).toLocaleDateString()}
          </Text>
          <Button
            label="Share the link"
            variant="primary"
            // Never disabled. This code's seat was reserved when it was minted, so the
            // twentieth invitation would otherwise be spent the instant it appeared and
            // unshareable forever after — the plaintext exists only in this component.
            // §4.5: a code already sent is a promise.
            style={{ marginTop: space.md, alignSelf: 'stretch' }}
            onPress={() => {
              void Share.share({
                message: `Join our Family on Family Bingo. Your code is ${code.code}.`,
              });
            }}
          />
        </View>
      )}

      {isOrganizer && code === null ? (
        <Button
          label={invite.isPending ? 'Making one…' : 'Invite someone'}
          variant="primary"
          disabled={invite.isPending || full}
          style={{ marginTop: space.lg }}
          onPress={() =>
            invite.mutate(undefined, {
              onSuccess: (row) => {
                setTrouble(null);
                setCode({ code: row.code, expires_at: row.expires_at });
              },
              onError: (e) =>
                say(
                  /full/i.test(e instanceof Error ? e.message : '')
                    ? 'This Family is full for now. Removing someone frees a seat.'
                    : 'That didn’t work. Have another go in a moment.',
                ),
            })
          }
        />
      ) : null}

      {trouble === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={{ ...styles.body, color: color.ink2, marginTop: space.md }}
        >
          {trouble}
        </Text>
      )}

      {roster.isError ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>
          Couldn’t load who’s in just now. Try again in a moment.
        </Text>
      ) : null}

      <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xxl }}>Who&rsquo;s in</Text>

      <View style={{ marginTop: space.md, gap: space.md }}>
        {members.map((member) => (
          <View
            key={member.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
          >
            <Avatar
              name={member.display_name}
              pending={member.status === 'pending'}
              managed={member.is_managed}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ ...styles.body, color: color.ink }}>{member.display_name}</Text>
              <Text style={{ ...styles.meta, color: color.ink2 }}>
                {member.status === 'pending'
                  ? 'waiting to be let in'
                  : member.role === 'organizer'
                    ? 'organizer'
                    : ''}
              </Text>
            </View>

            {/* §3.4 — "remove a Member at any time", and the only way a full Family frees
                a seat. Never the Organizer's own row: remove_member() refuses to leave a
                Family with no Organizer, and offering it here would be offering an error. */}
            {isOrganizer && member.status === 'active' && member.id !== family?.member.id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${member.display_name} from the Family`}
                onPress={() =>
                  Alert.alert(
                    `Remove ${member.display_name}?`,
                    'Their board and everything on it goes too. They can be invited again.',
                    [
                      { text: 'Keep them', style: 'cancel' },
                      { text: 'Remove', onPress: () => actions.remove.mutate(member.id) },
                    ],
                  )
                }
                style={{
                  minHeight: size.minTouch,
                  justifyContent: 'center',
                  paddingHorizontal: space.md,
                }}
              >
                <Text style={{ ...styles.label, color: color.clayDeep }}>Remove</Text>
              </Pressable>
            ) : null}

            {/* §3.3 — the second gate. A link forwarded before its first use stops here. */}
            {isOrganizer && member.status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Let ${member.display_name} in`}
                  onPress={() => actions.approve.mutate(member.id)}
                  style={{
                    minHeight: size.minTouch,
                    justifyContent: 'center',
                    paddingHorizontal: space.md,
                    backgroundColor: color.moss,
                    borderRadius: radius.card,
                  }}
                >
                  <Text style={{ ...styles.label, color: color.paper }}>Let in</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Turn ${member.display_name} away`}
                  onPress={() =>
                    Alert.alert(
                      `Turn ${member.display_name} away?`,
                      'They can be invited again later.',
                      [
                        { text: 'Keep waiting', style: 'cancel' },
                        { text: 'Turn away', onPress: () => actions.reject.mutate(member.id) },
                      ],
                    )
                  }
                  style={{
                    minHeight: size.minTouch,
                    justifyContent: 'center',
                    paddingHorizontal: space.md,
                  }}
                >
                  {/* clayDeep on paper. There is no red in this palette (§1.1). */}
                  <Text style={{ ...styles.label, color: color.clayDeep }}>Not now</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        {/* Invited-but-not-joined: a ring at 75% and the word. Never a badge, never a nag. */}
        {open.map((invitation) => (
          <View
            key={invitation.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
          >
            <Avatar name="" pending />
            <View style={{ flex: 1 }}>
              <Text style={{ ...styles.body, color: color.ink2 }}>Invitation sent</Text>
              <Text style={{ ...styles.meta, color: color.ink2 }}>invited</Text>
            </View>
            {isOrganizer ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel this invitation"
                onPress={() => actions.revoke.mutate(invitation.id)}
                style={{
                  minHeight: size.minTouch,
                  justifyContent: 'center',
                  paddingHorizontal: space.md,
                }}
              >
                <Text style={{ ...styles.label, color: color.clayDeep }}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.xxl, alignItems: 'flex-start' }}
        onPress={() => router.back()}
      />
    </ScrollView>
  );
}
