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
import { useMyBoards } from '../../lib/queries/boards';
import { useFamilies } from '../../lib/queries/families';
import {
  SEATS,
  useCreateInvitation,
  useRoster,
  useRosterActions,
} from '../../lib/queries/invitations';
import { useRemoveManagedMember } from '../../lib/queries/managed';
import { useOpenYear, useYears } from '../../lib/queries/years';
import { useSession } from '../../lib/session';
import { openableYear, sealCopy } from '../../src/domain/year';
import { draftProgress } from '../../src/domain/goal';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/** One phrase, used by both the visible text and the accessibility label. */
const yearSays = (year: {
  status: string;
  setup_deadline: string;
}): string =>
  year.status === 'setup'
    ? sealCopy(new Date(), new Date(year.setup_deadline))
    : year.status === 'active'
      ? 'under way'
      : 'finished';

export default function FamilyRoster() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const families = useFamilies(session?.user.id);
  const roster = useRoster(id);
  const invite = useCreateInvitation(id ?? '');
  const actions = useRosterActions(id ?? '');
  const removeChild = useRemoveManagedMember(id ?? '');
  const years = useYears(id);
  const openYear = useOpenYear(id ?? '');
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const say = (message: string) => {
    setTrouble(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const family = families.data?.find((f) => f.id === id);
  const isOrganizer = family?.member.role === 'organizer';
  // Both write paths on this screen require an active Member (create_managed_member checks
  // it, create_invitation checks Organizer). Without this the buttons render for a caller
  // the server will refuse, and the refusal reads as "have another go".
  const isMember = family !== undefined;
  const members = roster.data?.members ?? [];
  const open = roster.data?.invitations ?? [];
  // An outstanding invitation holds a seat: §4.5 says a code already sent is a promise,
  // and the server reserved it when it minted. Seats are only honest to an Organizer,
  // though — invitations_organizer_read denies everyone else, so `open` is empty for a
  // plain Member and a pip row built from it would claim free seats the server will refuse.
  const canCount = roster.data?.canSeeInvitations === true;

  // §5.1: one Year per Family per calendar year, and the window always ends on 1 January —
  // so the only Year anyone could be opening is the next one. A picker would be a choice
  // between one option and several errors.
  const timezone = family?.timezone ?? 'UTC';
  const allYears = years.data ?? [];
  const openable = openableYear(new Date(), timezone, allYears.map((y) => y.calendar_year));

  // `[0]` was newest-first by calendar year, which is not relevance: a frozen 2028 beside
  // an active 2027 showed "2028, finished" and hid the Year actually being played.
  const current =
    allYears.find((y) => y.status === 'active') ??
    allYears.find((y) => y.status === 'setup') ??
    allYears[0];
  const taken = members.length + open.length;
  const full = taken >= SEATS;

  // Slice 6's way in. Every Board in the current Year the caller may author on: their own,
  // plus one per Managed Member they guard (§4.2). The query filters to controlled Members
  // itself — `boards_read` is Family-wide, so an unfiltered list would offer links to
  // Boards write_goal() refuses.
  const myBoards = useMyBoards(current?.id, session?.user.id);

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

      {/* The Year, if there is one. §4.5's deadline copy is factual and never conditional:
          a date and a count of days, with nothing that could read as a scold (§0.3). */}
      {current === undefined ? null : (
        <View
          accessible
          accessibilityLabel={`${current.calendar_year}, ${
            current.status === 'setup'
              ? sealCopy(new Date(), new Date(current.setup_deadline))
              : current.status
          }`}
          style={{
            marginTop: space.lg,
            padding: space.md,
            backgroundColor: color.paperRaised,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: color.hairline,
          }}
        >
          <Text style={{ ...styles.cardHead, color: color.ink }}>{current.calendar_year}</Text>
          {/* The label and the visible text are the same words: a screen reader saying
              "frozen" where the screen says "finished" is two different apps (§6 A1). */}
          <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
            {yearSays(current)}
          </Text>
        </View>
      )}

      {/* The way onto a Board (§6). One row per Member the caller may author for, which is
          themselves plus any child they guard — a Guardian authoring for a Managed Member
          is the normal case, not an administrative one (§4.2). */}
      {(myBoards.data ?? []).map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          accessibilityLabel={`${b.memberName}: ${draftProgress(b.written)} goals written`}
          accessibilityHint="Opens the drafting table"
          onPress={() => router.push({ pathname: '/board/[id]', params: { id: b.id } })}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            marginTop: space.md,
            padding: space.md,
            minHeight: size.minTouch,
            backgroundColor: color.paperRaised,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: color.hairline,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Avatar name={b.memberName} managed={b.isManaged} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...styles.body, color: color.ink }}>{b.memberName}</Text>
            <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xs }}>
              {b.sealedAt === null ? draftProgress(b.written) : 'sealed'}
            </Text>
          </View>
        </Pressable>
      ))}

      {/* Gated on the Years having loaded, or the button flashes for a Family that already
          has that Year and races straight into a PT409. */}
      {isOrganizer && !years.isPending && openable !== null ? (
        <Button
          label={openYear.isPending ? 'Opening…' : `Open ${openable}`}
          disabled={openYear.isPending}
          style={{ marginTop: space.lg }}
          onPress={() =>
            openYear.mutate(openable, {
              // Three distinct refusals, none of which a retry fixes. One message for all
              // three was advice that could never work.
              onError: (e) => {
                const raw = e instanceof Error ? e.message : '';
                say(
                  /organizer/i.test(raw)
                    ? 'Only the Organizer can open a Year.'
                    : /already|exists/i.test(raw)
                      ? `${openable} is already open.`
                      : /past|ended/i.test(raw)
                        ? 'That Year has already ended.'
                        : 'That didn’t open. Have another go in a moment.',
                );
              },
            })
          }
        />
      ) : null}

      {/* §4: any active adult Member may add a child, not just the Organizer — the
          Guardian is whoever is accountable for them (§4.3), and that is a parent rather
          than an administrator. */}
      {isMember ? (
      <Button
        label="Add a child"
        // `full` alone was the wrong gate: `open` is empty for a non-Organizer, so `taken`
        // undercounts and the button offered a seat the server would refuse.
        disabled={canCount ? full : false}
        style={{ marginTop: space.lg }}
        onPress={() => router.push({ pathname: '/family/child', params: { id: id ?? '' } })}
      />
      ) : null}

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
            {(member.is_managed || isOrganizer) &&
            member.status === 'active' &&
            member.id !== family?.member.id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${member.display_name} from the Family`}
                onPress={() =>
                  Alert.alert(
                    `Remove ${member.display_name}?`,
                    member.is_managed
                      ? // §4.4: a Managed Member cannot be invited, so "they can be invited
                        // again" would be an offer the app has no way to keep.
                        'Their board and everything on it goes too. You can add them again ' +
                        'whenever you like.'
                      : 'Their board and everything on it goes too. They can be invited again.',
                    [
                      { text: 'Keep them', style: 'cancel' },
                      {
                        text: 'Remove',
                        // A child is removed by their Guardian, an adult by the Organizer.
                        // Two RPCs because they answer to two different people (§4.3).
                        onPress: () =>
                          member.is_managed
                            ? removeChild.mutate(member.id)
                            : actions.remove.mutate(member.id),
                      },
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
