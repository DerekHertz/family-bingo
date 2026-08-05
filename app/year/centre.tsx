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

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { leaveTo } from '../../lib/leave';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { ErrorState, FormScreen, Loading, Trouble } from '../../components/Screen';
import { useAnnounce } from '../../lib/announce';
import {
  MAX_PROPOSALS_PER_MEMBER,
  useCastBallot,
  useCentre,
  useProposeGoal,
  useSetTiebreak,
  useWithdrawProposal,
  voteFailureCopy,
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
function Voters({ names }: { names: { id: string; name: string; isManaged: boolean }[] }) {
  if (names.length === 0) return null;
  return (
    <View
      // Not `accessible` — the card that owns this row already names the voters in its
      // own label, and marking this a group would have merged it into that element
      // anyway. Hidden here, said there, once.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', gap: space.xs, marginLeft: 'auto' }}
    >
      {/* Keyed by Member id. Two people in one Family can share a display name — with
          Managed Members that is ordinary, not a corner case — and a name key would
          collide. */}
      {names.map((n) => (
        <Avatar key={n.id} name={n.name} size={22} managed={n.isManaged} />
      ))}
    </View>
  );
}

export default function Centre() {
  const { yearId, familyId } = useLocalSearchParams<{ yearId: string; familyId: string }>();
  const session = useSession();
  const centre = useCentre(yearId, session?.user.id, familyId);
  const families = useFamilies(session?.user.id);
  const castBallot = useCastBallot(yearId ?? '');
  const propose = useProposeGoal(yearId ?? '');
  const withdraw = useWithdrawProposal(yearId ?? '');
  const tiebreak = useSetTiebreak(yearId ?? '');

  // Re-renders when the window closes. Without it a Member sitting on this screen at the
  // deadline keeps being offered controls the server has already stopped accepting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const [votingAs, setVotingAs] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // `clear` is called on every success, so a refusal cannot outlive the thing it refused.
  const { trouble, say, clear: clearTrouble } = useAnnounce();

  if (centre.isPending) return <Loading what="Loading the centre" />;

  if (centre.isError || centre.data === undefined) {
    return (
      <ErrorState
        message="Couldn’t load the centre just now. Try again in a moment."
        backTo={{ pathname: '/family/[id]', params: { id: familyId ?? '' } }}
      />
    );
  }

  const { modeVote, goalVote, proposals, modeBallots, goalBallots, voters } = centre.data;
  const family = families.data?.find((f) => f.id === familyId);
  const isOrganizer = family?.member.role === 'organizer';

  // Defaults to the caller's own Member. A Guardian casts their children's Ballots too —
  // one vote each, and a Guardian never gets two of their own (§4.3).
  const actingAs = votingAs ?? voters.find((v) => !v.isManaged)?.id ?? voters[0]?.id ?? null;
  // Mirrors `resolve_center_vote`'s `greatest(mode_vote.closes_at, goal_vote.closes_at)`.
  //
  // Reading only the mode Vote's deadline happened to be right — `open_year()` gives both
  // the same `closes_at` and `resolve_center_vote` flips both in one statement — but it
  // was an invariant the client assumed and the server never promised. §21.1's personal
  // deadline is exactly the shape that would break it, and the failure would be silent:
  // a goal section still writable past its own close, every write refused PT403.
  const closesAt = Math.max(
    ...[modeVote, goalVote]
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .map((v) => new Date(v.closesAt).getTime()),
    0,
  );
  const closed =
    modeVote === null ||
    (modeVote.status === 'resolved' && (goalVote?.status ?? 'resolved') === 'resolved') ||
    closesAt <= now;

  const myModeBallot = modeBallots.find((b) => b.memberId === actingAs)?.choiceMode ?? null;
  const myGoalBallot = goalBallots.find((b) => b.memberId === actingAs)?.proposalId ?? null;
  const modeChoices = modeBallots
    .map((b) => b.choiceMode)
    .filter((c): c is CenterMode => c !== null);

  // Where the mode is heading — used to word the section, never to hide it.
  //
  // Hiding the Goal vote whenever the live tally said `personal` was a real trap, because
  // `resolveModeVote([])` is `personal` (§8.3): the section was invisible until somebody
  // voted, and it VANISHED again the moment a late `personal` ballot made it a tie —
  // taking every Proposal and every goal Ballot with it. A Family could then no longer
  // propose, vote, move a vote or withdraw, and if the blackout lasted to the deadline
  // `resolve_center_vote` found no ballots and fell back to `personal` (§9.3). The UI
  // would have caused the outcome. Nothing is hidden now.
  const headingShared = resolveModeVote(modeChoices) === 'shared';

  const mineCount = proposals.filter((p) => p.memberId === actingAs).length;

  const voteFor = (proposalId: string) => {
    if (actingAs === null || goalVote === null) return;
    castBallot.mutate(
      { voteId: goalVote.id, memberId: actingAs, proposalId },
      { onSuccess: clearTrouble, onError: (e) => say(voteFailureCopy(e)) },
    );
  };

  return (
    // The extra bottom padding is this screen's own: the proposal list can run long and
    // the "Put it forward" field sits at the end of it.
    <FormScreen contentStyle={{ paddingBottom: space.xxl }}>
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
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Voting as"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}
          >
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

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Share the middle square?"
        style={{ gap: size.stack, marginTop: space.md }}
      >
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
              accessibilityLabel={`${label}. ${
                modeBallots.filter((b) => b.choiceMode === mode).length === 0
                  ? voteCountCopy(0)
                  : `Voted: ${modeBallots
                      .filter((b) => b.choiceMode === mode)
                      .map((b) => b.memberName)
                      .join(', ')}`
              }`}
              disabled={closed || actingAs === null || modeVote === null}
              onPress={() =>
                modeVote !== null &&
                actingAs !== null &&
                castBallot.mutate(
                  { voteId: modeVote.id, memberId: actingAs, choiceMode: mode },
                  { onSuccess: clearTrouble, onError: (e) => say(voteFailureCopy(e)) },
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
                names={others.map((b) => ({
                  id: b.memberId,
                  name: b.memberName,
                  isManaged: b.isManaged,
                }))}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Once it has resolved, say what it DECIDED — past tense, from the Vote's own
          `outcome`, not from a tally recomputed after the fact.
          §9.3 is why this matters rather than being a nicety: a Family can vote shared
          and still get a personal centre because nobody proposed. Recomputing the tally
          would have gone on saying "you'll share one goal in the middle" beside "the
          centre is decided", which is two lines of the same screen disagreeing. The
          migration keeps `voted_mode` and `resolved_mode` apart for exactly this. */}
      <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
        {closed && modeVote?.outcome != null
          ? modeVote.outcome === 'shared'
            ? 'You chose to share one goal in the middle.'
            : 'You chose to each write your own middle square.'
          : modeStandingCopy(modeChoices)}
      </Text>

      {/* ── Slice 9: the Goal, only while shared is where this is heading ──────── */}
      {goalVote !== null ? (
        <>
          <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xxl }}>
            What should it be?
          </Text>

          {/* Said once, quietly, and never as a shortfall — "these are here if that
              changes" is a fact about the list, not a request for votes (§8.4). */}
          {!headingShared ? (
            <Text style={{ ...styles.label, color: color.ink3, marginTop: space.xs }}>
              As it stands everyone writes their own. These are here if that changes.
            </Text>
          ) : null}

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Goals put forward"
            style={{ gap: size.stack, marginTop: space.md }}
          >
            {proposals.map((p) => {
              const votes = goalBallots.filter((b) => b.proposalId === p.id);
              const chosen = myGoalBallot === p.id;
              const isTiebreak = goalVote.organizerTiebreakProposalId === p.id;
              return (
                <View key={p.id}>
                  {/* The card holds NO interactive children. A Pressable is
                      accessible by default, and an accessible container merges its
                      whole subtree into one element on iOS — which made "Take it back"
                      and the tiebreak row unreachable to VoiceOver entirely, and
                      swallowed the voters' label with them. A Guardian could not
                      withdraw their own Proposal; an Organizer could not record a
                      tiebreak. The actions are siblings now, the same shape
                      components/SuggestionCards.tsx already uses. */}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen, disabled: closed }}
                    accessibilityLabel={`${p.text}, put forward by ${p.memberName}. ${
                      votes.length === 0
                        ? 'No votes yet'
                        : `Voted: ${votes.map((b) => b.memberName).join(', ')}`
                    }`}
                    disabled={closed || actingAs === null}
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
                      {/* §7 rule 9: never a vote count as a numeral. "4 votes" beside
                          somebody's idea is the ranking rule 2 forbids, wearing a
                          different hat — a Proposal has an author. Zero is the one case
                          with nothing to draw, and §4.3 gives it words instead. */}
                      <Text style={{ ...styles.meta, color: color.ink3 }}>
                        {votes.length === 0 ? voteCountCopy(0) : ''}
                        {isTiebreak ? (votes.length === 0 ? ' · ' : '') + 'organizer’s pick if it ties' : ''}
                      </Text>
                      <Voters
                        names={votes
                          .filter((b) => b.memberId !== actingAs)
                          .map((b) => ({ id: b.memberId, name: b.memberName, isManaged: b.isManaged }))}
                      />
                    </View>
                  </Pressable>

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
                              withdraw.mutate(p.id, {
                                onSuccess: clearTrouble,
                                onError: (e) => say(voteFailureCopy(e)),
                              }),
                          },
                        ])
                      }
                      style={{ minHeight: size.minTouch, justifyContent: 'center', paddingHorizontal: space.md }}
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
                          { onSuccess: clearTrouble, onError: (e) => say(voteFailureCopy(e)) },
                        )
                      }
                      style={{ minHeight: size.minTouch, justifyContent: 'center', paddingHorizontal: space.md }}
                    >
                      <Text style={{ ...styles.label, color: color.ink2 }}>
                        Pick this one if it ties
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
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
            {closed && goalVote.outcome != null
              ? goalVote.outcome === 'personal'
                ? // §9.3 said plainly, and without blame. Nobody failed at anything.
                  'Nobody put one forward, so everyone writes their own.'
                : 'This one went in the middle.'
              : goalStandingCopy(
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
              <Field
                value={draft}
                onChangeText={setDraft}
                placeholder="A camping trip, all five of us"
                multiline
                accessibilityLabel="A goal for the middle square"
                accessibilityHint={`Up to ${GOAL_TEXT.max} characters`}
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
                    {
                      onSuccess: () => {
                        setDraft('');
                        clearTrouble();
                      },
                      onError: (e) => say(voteFailureCopy(e)),
                    },
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

      {/* `live={false}`: every message here arrives through `say()`, which already
          announces it. A live region on top of that makes Android say it twice. */}
      <Trouble message={trouble} live={false} style={{ marginTop: space.lg }} />

      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: familyId ?? '' } })}
      />
    </FormScreen>
  );
}
