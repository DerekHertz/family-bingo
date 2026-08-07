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
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { leaveTo } from '../../lib/leave';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { ConfirmSheet, type Confirmation } from '../../components/ConfirmSheet';
import { Loading, Trouble } from '../../components/Screen';
import { SeatPips } from '../../components/SeatPips';
import { useAnnounce } from '../../lib/announce';
import { useIsDemo } from '../../lib/demo';
import { failure } from '../../lib/failure';
import { useMyBoards, useYearReadiness } from '../../lib/queries/boards';
import { useFamilies } from '../../lib/queries/families';
import {
  SEATS,
  useCreateInvitation,
  useRoster,
  useRosterActions,
} from '../../lib/queries/invitations';
import { useRemoveManagedMember } from '../../lib/queries/managed';
import { openYearFailureCopy, useOpenYear, useYears } from '../../lib/queries/years';
import { useSession } from '../../lib/session';
import {
  hasOpenSetupWindow,
  openableYear,
  relevantYear,
  sealCopy,
} from '../../src/domain/year';
import { draftProgress } from '../../src/domain/goal';
import { type Readiness, readiness, readinessCopy } from '../../src/domain/ready';
import { joinedMarkerInline } from '../../src/domain/joining';
import { styles } from '../../theme/fonts';
import { color, radius, size, space, stroke } from '../../theme/tokens';

/**
 * One phrase, used by both the visible text and the accessibility label.
 *
 * The Setup Window's copy now has two halves and both are facts about the same Year: when
 * the date will decide it, and where the Family have got to on their own (§22.3). Either
 * one alone is misleading — a countdown says nothing about a Family who are all finished
 * and about to seal, and "everyone is done" says nothing about the deadline that still
 * backstops a Family who never are.
 */
const yearSays = (
  year: { status: string; setup_deadline: string },
  ready: Readiness,
): string =>
  year.status === 'setup'
    ? `${sealCopy(new Date(), new Date(year.setup_deadline))} · ${readinessCopy(ready)}`
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
  // `Alert.alert` is a no-op on react-native-web, so both confirms below were controls
  // that did nothing on the deployed build — see components/ConfirmSheet.tsx.
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const { trouble, say, clear } = useAnnounce();
  /**
   * The public demo, which is the same screen with nothing on it that writes.
   *
   * Every write inside the Year is already refused by §20.1, because the demo Family's Year
   * is frozen — that needs nothing here. This is for the two controls that are *not* inside
   * a Year and are therefore refused by `20260801000039` instead: adding a child, and
   * removing a Member. Both would render, both would fail, and §0.3 does not allow a
   * control whose only possible answer is no.
   */
  const readOnly = useIsDemo();

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

  // The calendar decides which Year this is — not the sort order, and not the status.
  //
  // This was `find(active) ?? find(setup) ?? [0]`, which is a guess at relevance rather
  // than an answer. `useYears` returns newest-first, so a Family with 2026 and 2027 both
  // in `setup` got 2027: the screen said 2027 in August 2026, having never once asked
  // what year it was. Status cannot answer this — it says where a Year is in its own
  // life, not whether it is the one happening.
  const current = relevantYear(new Date(), timezone, allYears);
  const taken = members.length + open.length;
  const full = taken >= SEATS;

  // Slice 6's way in. Every Board in the current Year the caller may author on: their own,
  // plus one per Managed Member they guard (§4.2). The query filters to controlled Members
  // itself — `boards_read` is Family-wide, so an unfiltered list would offer links to
  // Boards write_goal() refuses.
  const myBoards = useMyBoards(current?.id, session?.user.id);

  // §22.3 — where the whole Family has got to, which is the opposite scope from
  // `myBoards`: "waiting on Bob" is a fact about the Family, and a list narrowed to the
  // caller's own Boards can only ever say the caller is waiting on themselves. Asked only
  // while the Year is still being authored; afterwards there is nobody left to wait for.
  const familyReadiness = useYearReadiness(
    current?.status === 'setup' ? current.id : undefined,
    session?.user.id,
  );

  // Empty until the query resolves, or while the Year is not in setup and it never runs —
  // which `readinessCopy` renders as "no boards yet" and `yearSays` only ever asks for
  // during the Setup Window.
  const readyState = readiness(familyReadiness.data ?? []);

  if (roster.isPending || families.isPending) return <Loading what="Loading the roster" />;

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
            borderWidth: stroke.hairline,
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
          accessibilityLabel={`${current.calendar_year}, ${yearSays(current, readyState)}`}
          style={{
            marginTop: space.lg,
            padding: space.md,
            backgroundColor: color.paperRaised,
            borderRadius: radius.card,
            borderWidth: stroke.hairline,
            borderColor: color.hairline,
          }}
        >
          <Text style={{ ...styles.cardHead, color: color.ink }}>{current.calendar_year}</Text>
          {/* The label and the visible text are the same words: a screen reader saying
              "frozen" where the screen says "finished" is two different apps (§6 A1). */}
          <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
            {yearSays(current, readyState)}
          </Text>
        </View>
      )}

      {/* The way into the Feed (§14). Below the Year card because it is *about* that Year:
          the Feed is scoped to one Family and one Year (§14.1), and there is no version of
          it that spans two.

          Not a badge and not an unread count. §15.3 spends the whole notification budget
          on Milestones precisely so the ~3,300 Increments a family logs in a year land
          somewhere that does not ask to be cleared — a number on this row would undo that
          in one component. */}
      {current === null || current === undefined ? null : (
        <Button
          label="What’s happened"
          variant="outlined"
          style={{ marginTop: space.md }}
          onPress={() =>
            router.push({
              pathname: '/year/feed',
              params: { yearId: current.id, familyId: id ?? '' },
            })
          }
        />
      )}

      {/* And the way into Wrapped (§20), which is the same Year seen from the other end.
          Gated on the Freeze rather than on the status word, because `frozen_at` is the
          fact `generate_wrapped()` itself requires — it refuses a Year that has not frozen
          with PT403, and `wrapped` has no row until it runs. A button offered a moment
          early would open a screen with nothing in it.

          §20.10 keeps this here forever: a frozen Year and its Wrapped stay browsable as
          family history, so this is not a notification that expires. Both buttons stand
          together on a frozen Year — the Feed is what happened, Wrapped is what it added
          up to, and a Family looking back wants either. */}
      {/* One row per frozen Year, **not** one for `relevantYear`.
          `relevantYear()` answers "which Year is happening" and returns exactly one — so
          the moment the final Wrapped card's own button opens the next Year, `current`
          becomes that Year, its `frozen_at` is null, and the button disappears. The
          previous Year's Wrapped would then be unreachable from anywhere in the app: this
          is its only navigation, and the §20.3 push carries no deep link. A Member would
          have lost last year's Almanac by tapping the button on last year's Almanac.

          §20.10 is explicit that a frozen Year and its Wrapped "stay browsable forever as
          family history", so the list is the frozen Years, newest first — which is the
          order `useYears` already returns. */}
      {allYears
        .filter((y) => y.frozen_at !== null)
        .map((y) => (
          <Button
            key={y.id}
            label={`${y.calendar_year} wrapped`}
            accessibilityHint="Your year, the family's year, and the awards"
            style={{ marginTop: space.md }}
            onPress={() =>
              router.push({
                pathname: '/year/wrapped',
                params: { yearId: y.id, familyId: id ?? '' },
              })
            }
          />
        ))}

      {/* The way onto a Board (§6). One row per Member the caller may author for, which is
          themselves plus any child they guard — a Guardian authoring for a Managed Member
          is the normal case, not an administrative one (§4.2). */}
      {(myBoards.data ?? []).map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          // Mirrors the visible text below, including the seal. It said "3 of 24 goals
          // written" on a sealed Board where the screen said "sealed" — a screen reader
          // saying something different from the screen is two different apps (§6 A1), and
          // this file already makes that argument about "frozen" versus "finished".
          accessibilityLabel={`${b.memberName}: ${
            b.sealedAt !== null
              ? 'board sealed'
              : b.readyAt !== null
                ? 'board done, waiting for the family'
                : `${draftProgress(b.written)} goals written`
          }${b.joinedLateAt === null ? '' : `, ${joinedMarkerInline(b.joinedLateAt, timezone)}`}`}
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
            borderWidth: stroke.hairline,
            borderColor: color.hairline,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Avatar name={b.memberName} managed={b.isManaged} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...styles.body, color: color.ink }}>{b.memberName}</Text>
            {/* §21.4 — a Guardian reading "3 of 24" against a child approved in July has
                nothing on this row to say why, and neglect is the obvious reading. A
                statement of fact and nothing more: §21.5 removed proration because §13.5
                removed ranking, so there is nothing here to be behind in. */}
            <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xs }}>
              {[
                // §22.2 — three states, not two. A Board that is full and declared done is
                // not the same as one still being written, and "24 of 24" said nothing
                // about whether its owner had finished with it.
                b.sealedAt !== null
                  ? 'sealed'
                  : b.readyAt !== null
                    ? 'done'
                    : draftProgress(b.written),
                b.joinedLateAt === null
                  ? null
                  : joinedMarkerInline(b.joinedLateAt, timezone),
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </Text>
          </View>
        </Pressable>
      ))}

      {/* Gated on the Years having loaded, or the button flashes for a Family that already
          has that Year and races straight into a PT409.

          Also gated on no Setup Window already being open. Opening a second one is legal —
          §5.1 only forbids two Years with the same calendar year — but it is how a Family
          ends up with two Boards being authored at once and nothing on screen to say which
          is which. That is exactly how a 2027 Board appeared in August: 2026 was open, so
          the button offered the next free year, and it was taken. Once 2026 seals this
          comes back on its own, which is the December case working as intended. */}
      {isOrganizer && !years.isPending && openable !== null && !hasOpenSetupWindow(allYears) ? (
        <Button
          label={openYear.isPending ? 'Opening…' : `Open ${openable}`}
          disabled={openYear.isPending}
          style={{ marginTop: space.lg }}
          onPress={() =>
            openYear.mutate(openable, {
              // Three distinct refusals, none of which a retry fixes, and the copy for all
              // three lives beside the mutation (`openYearFailureCopy`).
              onError: (e) => say(openYearFailureCopy(e, openable)),
            })
          }
        />
      ) : null}

      {/* §4: any active adult Member may add a child, not just the Organizer — the
          Guardian is whoever is accountable for them (§4.3), and that is a parent rather
          than an administrator.

          **Not in the demo.** `create_managed_member()` is one of the handful of writes a
          frozen Year cannot reach, so `20260801000039` refuses it at the database — and a
          control that is guaranteed to answer "no" is the §0.3 failure exactly. The banner
          above has already said nothing here can change; the interface should agree with
          it rather than argue. */}
      {isMember && !readOnly ? (
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
                clear();
                setCode({ code: row.code, expires_at: row.expires_at });
              },
              onError: (e) =>
                say(
                  /full/i.test(failure(e).message)
                    ? 'This Family is full for now. Removing someone frees a seat.'
                    : 'That didn’t work. Have another go in a moment.',
                ),
            })
          }
        />
      ) : null}

      <Trouble message={trouble} />

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
            !readOnly &&
            member.status === 'active' &&
            member.id !== family?.member.id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${member.display_name} from the Family`}
                onPress={() =>
                  setConfirming({
                    title: `Remove ${member.display_name}?`,
                    body: member.is_managed
                      ? // §4.4: a Managed Member cannot be invited, so "they can be invited
                        // again" would be an offer the app has no way to keep.
                        'Their board and everything on it goes too. You can add them again ' +
                        'whenever you like.'
                      : 'Their board and everything on it goes too. They can be invited again.',
                    confirmLabel: 'Remove',
                    cancelLabel: 'Keep them',
                    // A child is removed by their Guardian, an adult by the Organizer.
                    // Two RPCs because they answer to two different people (§4.3).
                    onConfirm: () =>
                      member.is_managed
                        ? removeChild.mutate(member.id)
                        : actions.remove.mutate(member.id),
                  })
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
                    setConfirming({
                      title: `Turn ${member.display_name} away?`,
                      body: 'They can be invited again later.',
                      confirmLabel: 'Turn away',
                      cancelLabel: 'Keep waiting',
                      onConfirm: () => actions.reject.mutate(member.id),
                    })
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
        onPress={() => leaveTo('/home')}
      />
      <ConfirmSheet confirmation={confirming} onClose={() => setConfirming(null)} />
    </ScrollView>
  );
}
