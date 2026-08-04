/**
 * The Centre — Slices 8 and 9 (PRD §8, §9, FRONTEND_DESIGN §4.3).
 *
 * The middle square is the only one a Family decides together. First whether to share it
 * at all, then — if they do — which Goal goes on it.
 *
 * **§8.4 is the rule this screen is most likely to break: never blockable by inaction.**
 * There is no quorum, no "waiting on 2 more", no nudge to go and ask someone. In any
 * family of five at least one person is a lurker, and their silence must not freeze four
 * other people's Boards. So nothing here counts down to a threshold, and the standing
 * outcome is stated as a fact rather than as a race (§4.3, §0.3).
 *
 * `clay` throughout, because clay means family and nothing else (§1.1). Not `moss` —
 * agreeing on a goal is not growth, and the accent has to keep meaning one thing.
 *
 * The vote is resolved by `pg_cron` at the deadline, not here. Everything on this screen
 * is `src/domain/votes.ts` showing the Family what that will decide, using the same rules
 * the SQL uses — and the two are kept in step deliberately (see migration 15's header).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import {
  MAX_PROPOSALS_PER_MEMBER,
  useCastBallot,
  useCentre,
  useProposeGoal,
  useSetTiebreak,
  useWithdrawProposal,
} from '../../lib/queries/votes';
import { useFamilies } from '../../lib/queries/families';
import { useSession } from '../../lib/session';
import { GOAL_TEXT, goalTextProblem } from '../../src/domain/goal';
import {
  type CenterMode,
  goalStandingCopy,
  modeStandingCopy,
  resolveModeVote,
  voteCountCopy,
} from '../../src/domain/votes';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/** The centre-tile glyph §4.3 asks for: a 5×5 with only the middle square filled. */
function CentreGlyph() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', flexWrap: 'wrap', width: 46, gap: 2 }}
    >
      {Array.from({ length: 25 }, (_, i) => (
        <View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            backgroundColor: i === 12 ? color.clay : color.clayTint,
          }}
        />
      ))}
    </View>
  );
}

/** Other people's votes as faces, right-aligned — never as a count (§4.3). */
function Voters({ names }: { names: { name: string; isManaged: boolean }[] }) {
  if (names.length === 0) return null;
  return (
    <View
      accessible
      accessibilityLabel={`Voted: ${names.map((n) => n.name).join(', ')}`}
      style={{ flexDirection: 'row', gap: space.xs, marginLeft: 'auto' }}
    >
      {names.map((n) => (
        <Avatar key={n.name} name={n.name} size={22} managed={n.isManaged} />
      ))}
    </View>
  );
}

export default function Centre() {
  const { yearId, familyId } = useLocalSearchParams<{ yearId: string; familyId: string }>();
  const router = useRouter();
  const session = useSession();
  const centre = useCentre(yearId, session?.user.id);
  const families = useFamilies(session?.user.id);
  const castBallot = useCastBallot(yearId ?? '');
  const propose = useProposeGoal(yearId ?? '');
  const withdraw = useWithdrawProposal(yearId ?? '');
  const tiebreak = useSetTiebreak(yearId ?? '');

  const [votingAs, setVotingAs] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);

  const say = (message: string) => {
    setTrouble(message);
    // accessibilityLiveRegion is Android-only; iOS has to be told outright (§6 A6).
    AccessibilityInfo.announceForAccessibility(message);
  };

  if (centre.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading the centre"
        />
      </View>
    );
  }

  if (centre.isError || centre.data === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, paddingTop: size.screenTop }}>
        <Text style={{ ...styles.body, color: color.ink2 }}>
          Couldn&rsquo;t load the centre just now. Try again in a moment.
        </Text>
        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
          onPress={() => router.back()}
        />
      </View>
    );
  }

  const { modeVote, goalVote, proposals, modeBallots, goalBallots, voters } = centre.data;
  const family = families.data?.find((f) => f.id === familyId);
  const isOrganizer = family?.member.role === 'organizer';

  // Defaults to the caller's own Member. A Guardian casts their children's Ballots too —
  // one vote each, and a Guardian never gets two of their own (§4.3).
  const actingAs = votingAs ?? voters.find((v) => !v.isManaged)?.id ?? voters[0]?.id ?? null;
  const closed =
    modeVote === null ||
    modeVote.status === 'resolved' ||
    new Date(modeVote.closesAt).getTime() <= Date.now();

  const myModeBallot = modeBallots.find((b) => b.memberId === actingAs)?.choiceMode ?? null;
  const myGoalBallot = goalBallots.find((b) => b.memberId === actingAs)?.proposalId ?? null;
  const modeChoices = modeBallots
    .map((b) => b.choiceMode)
    .filter((c): c is CenterMode => c !== null);

  // §9.1 runs only if the mode is heading for shared. Showing the Goal vote while the
  // Family is heading for personal would be asking them to do work that gets discarded.
  const headingShared = resolveModeVote(modeChoices) === 'shared';

  const mineCount = proposals.filter((p) => p.memberId === actingAs).length;

  const refusal = (e: unknown): string => {
    const raw = e instanceof Error ? e.message : '';
    return /closed|PT403/i.test(raw)
      ? 'The setup window has closed — the centre is decided now.'
      : /at most 3|PT409/i.test(raw)
        ? `That’s all ${MAX_PROPOSALS_PER_MEMBER} of yours. Take one back to make room.`
        : /no longer be withdrawn/i.test(raw)
          ? 'Somebody has voted for this one, so it stays.'
          : /not your Member/i.test(raw)
            ? 'That isn’t yours to vote with.'
            : 'That didn’t go through. Have another go in a moment.';
  };

  const voteFor = (proposalId: string) => {
    if (actingAs === null || goalVote === null) return;
    castBallot.mutate(
      { voteId: goalVote.id, memberId: actingAs, proposalId },
      { onError: (e) => say(refusal(e)) },
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
          The centre
        </Text>

        {/* §4.3's clayTint explainer block with the centre-tile glyph. */}
        <View
          style={{
            flexDirection: 'row',
            gap: space.md,
            alignItems: 'center',
            marginTop: space.lg,
            padding: space.lg,
            backgroundColor: color.clayTint,
            borderRadius: radius.card,
          }}
        >
          <CentreGlyph />
          <Text style={{ ...styles.body, color: color.ink, flex: 1 }}>
            The middle square is the family&rsquo;s. You can share one goal there, or each
            write your own.
          </Text>
        </View>

        {/* Whose vote is being cast. Only when there is a choice to make — a Member with
            no children never sees it (§0.2, nothing on screen that does nothing). */}
        {voters.length > 1 ? (
          <View style={{ marginTop: space.lg }}>
            <Text style={{ ...styles.meta, color: color.ink2 }}>Voting as</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
              {voters.map((v) => (
                <Pressable
                  key={v.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: v.id === actingAs }}
                  accessibilityLabel={`Vote as ${v.name}`}
                  onPress={() => setVotingAs(v.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    minHeight: size.minTouch,
                    paddingHorizontal: space.md,
                    borderRadius: radius.pill,
                    borderWidth: 1.5,
                    borderColor: v.id === actingAs ? color.clay : color.hairline,
                    backgroundColor: color.paperRaised,
                  }}
                >
                  <Avatar name={v.name} size={22} managed={v.isManaged} />
                  <Text style={{ ...styles.label, color: color.ink }}>{v.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Slice 8: the mode ─────────────────────────────────────────────────── */}
        <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xxl }}>
          Share the middle square?
        </Text>

        <View style={{ gap: size.stack, marginTop: space.md }}>
          {(
            [
              ['shared', 'Yes — one goal, all of us'],
              ['personal', 'No — everyone writes their own'],
            ] as const
          ).map(([mode, label]) => {
            const chosen = myModeBallot === mode;
            const others = modeBallots.filter(
              (b) => b.choiceMode === mode && b.memberId !== actingAs,
            );
            return (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen, disabled: closed }}
                accessibilityLabel={`${label}. ${voteCountCopy(
                  modeBallots.filter((b) => b.choiceMode === mode).length,
                )}`}
                disabled={closed || actingAs === null || modeVote === null}
                onPress={() =>
                  modeVote !== null &&
                  actingAs !== null &&
                  castBallot.mutate(
                    { voteId: modeVote.id, memberId: actingAs, choiceMode: mode },
                    { onError: (e) => say(refusal(e)) },
                  )
                }
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  minHeight: size.control,
                  padding: space.md,
                  borderRadius: radius.card,
                  backgroundColor: color.paperRaised,
                  // 1.5px clay inset when it is your vote (§4.3).
                  borderWidth: 1.5,
                  borderColor: chosen ? color.clay : color.hairline,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ ...styles.body, color: color.ink, flexShrink: 1 }}>{label}</Text>
                {chosen ? (
                  <View
                    style={{
                      paddingHorizontal: space.sm,
                      paddingVertical: 2,
                      borderRadius: radius.pill,
                      backgroundColor: color.clayTint,
                    }}
                  >
                    <Text style={{ ...styles.meta, color: color.clayDeep }}>Your vote</Text>
                  </View>
                ) : null}
                <Voters
                  names={others.map((b) => ({ name: b.memberName, isManaged: b.isManaged }))}
                />
              </Pressable>
            );
          })}
        </View>

        {/* The standing outcome, as a fact. Never a count of what is still needed. */}
        <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
          {modeStandingCopy(modeChoices)}
        </Text>

        {/* ── Slice 9: the Goal, only while shared is where this is heading ──────── */}
        {headingShared && goalVote !== null ? (
          <>
            <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xxl }}>
              What should it be?
            </Text>

            <View style={{ gap: size.stack, marginTop: space.md }}>
              {proposals.map((p) => {
                const votes = goalBallots.filter((b) => b.proposalId === p.id);
                const chosen = myGoalBallot === p.id;
                const isTiebreak = goalVote.organizerTiebreakProposalId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen, disabled: closed }}
                    accessibilityLabel={`${p.text}, put forward by ${p.memberName}. ${voteCountCopy(
                      votes.length,
                    )}`}
                    disabled={closed}
                    onPress={() => voteFor(p.id)}
                    style={({ pressed }) => ({
                      padding: space.md,
                      borderRadius: radius.card,
                      backgroundColor: color.paperRaised,
                      borderWidth: 1.5,
                      borderColor: chosen ? color.clay : color.hairline,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text style={{ ...styles.body, color: color.ink, flex: 1 }}>{p.text}</Text>
                      {chosen ? (
                        <View
                          style={{
                            paddingHorizontal: space.sm,
                            paddingVertical: 2,
                            borderRadius: radius.pill,
                            backgroundColor: color.clayTint,
                          }}
                        >
                          <Text style={{ ...styles.meta, color: color.clayDeep }}>Your vote</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
                      <Text style={{ ...styles.meta, color: color.ink3 }}>
                        {/* Zero reads "No votes yet", never "0" (§4.3). */}
                        {voteCountCopy(votes.length)}
                        {isTiebreak ? ' · organizer’s pick if it ties' : ''}
                      </Text>
                      <Voters
                        names={votes
                          .filter((b) => b.memberId !== actingAs)
                          .map((b) => ({ name: b.memberName, isManaged: b.isManaged }))}
                      />
                    </View>

                    {/* Yours to take back, while nobody else has voted for it. */}
                    {p.memberId === actingAs && !closed ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Take back ${p.text}`}
                        onPress={() =>
                          Alert.alert('Take this one back?', 'It comes off the list.', [
                            { text: 'Leave it', style: 'cancel' },
                            {
                              text: 'Take it back',
                              onPress: () =>
                                withdraw.mutate(p.id, { onError: (e) => say(refusal(e)) }),
                            },
                          ])
                        }
                        style={{ minHeight: size.minTouch, justifyContent: 'center' }}
                      >
                        <Text style={{ ...styles.label, color: color.clayDeep }}>Take it back</Text>
                      </Pressable>
                    ) : null}

                    {/* §9.2 — recorded ahead of the deadline, because pg_cron resolves on
                        a clock and cannot stop to ask. An option, never an obligation:
                        without one the earliest Proposal decides (§4.3). */}
                    {isOrganizer && !closed && !isTiebreak ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`If it ties, choose ${p.text}`}
                        onPress={() =>
                          tiebreak.mutate(
                            { voteId: goalVote.id, proposalId: p.id },
                            { onError: (e) => say(refusal(e)) },
                          )
                        }
                        style={{ minHeight: size.minTouch, justifyContent: 'center' }}
                      >
                        <Text style={{ ...styles.label, color: color.ink2 }}>
                          Pick this one if it ties
                        </Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}

              {proposals.length === 0 ? (
                <Text style={{ ...styles.body, color: color.ink2 }}>
                  Nothing put forward yet. Anything goes — a trip, a project, a habit
                  you&rsquo;d all keep.
                </Text>
              ) : null}
            </View>

            <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
              {goalStandingCopy(
                {
                  proposals: proposals.map((p, order) => ({ id: p.id, order })),
                  ballots: goalBallots
                    .map((b) => b.proposalId)
                    .filter((id): id is string => id !== null),
                  organizerTiebreak: goalVote.organizerTiebreakProposalId ?? undefined,
                },
                (id) => proposals.find((p) => p.id === id)?.text,
              )}
            </Text>

            {/* Putting one forward. Max 3 each (§9.1), and the count is stated rather
                than the button silently vanishing. */}
            {!closed && actingAs !== null ? (
              <View style={{ marginTop: space.lg }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="A camping trip, all five of us"
                  placeholderTextColor={color.ink3}
                  multiline
                  accessibilityLabel="A goal for the middle square"
                  accessibilityHint={`Up to ${GOAL_TEXT.max} characters`}
                  style={{
                    ...styles.body,
                    minHeight: size.control,
                    padding: space.md,
                    color: color.ink,
                    backgroundColor: color.paperRaised,
                    borderWidth: 1,
                    borderColor: color.hairline,
                    borderRadius: radius.card,
                    textAlignVertical: 'top',
                  }}
                />
                <Button
                  label={
                    mineCount >= MAX_PROPOSALS_PER_MEMBER
                      ? `That’s all ${MAX_PROPOSALS_PER_MEMBER} of yours`
                      : 'Put it forward'
                  }
                  disabled={
                    propose.isPending || mineCount >= MAX_PROPOSALS_PER_MEMBER
                  }
                  style={{ marginTop: space.sm }}
                  onPress={() => {
                    const problem = goalTextProblem(draft);
                    if (problem !== null) {
                      say(problem);
                      return;
                    }
                    propose.mutate(
                      { voteId: goalVote.id, memberId: actingAs, text: draft },
                      { onSuccess: () => setDraft(''), onError: (e) => say(refusal(e)) },
                    );
                  }}
                />
              </View>
            ) : null}
          </>
        ) : null}

        {closed ? (
          <Text style={{ ...styles.label, color: color.ink3, marginTop: space.lg }}>
            The setup window has closed. The centre is decided.
          </Text>
        ) : null}

        {trouble === null ? null : (
          <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>{trouble}</Text>
        )}

        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.xl, alignItems: 'flex-start' }}
          onPress={() => router.back()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
