/**
 * The Center Vote: what kind of Center Tile a Year has, and — if the Family chose a
 * shared one — which Family Goal goes on it.
 *
 * The governing rule for both is PRD §8.4: **never blockable by inaction.** There is no
 * quorum, no unanimity, and no waiting on a non-voter, because in any family of five or
 * more at least one person is a lurker, and their silence must not freeze four other
 * people's Boards. Every path through this module therefore terminates in an outcome.
 *
 * Pure.
 */

export type CenterMode = 'shared' | 'personal';

export interface Proposal {
  readonly id: string;
  /** Arrival order. Proposals are never re-sorted by votes (FRONTEND_DESIGN §4.3). */
  readonly order: number;
}

export interface GoalVoteInput {
  readonly proposals: readonly Proposal[];
  /** Proposal ids, one per Ballot actually cast. Abstentions simply are not here. */
  readonly ballots: readonly string[];
  /** The Organizer's tiebreak, if they made one before the Setup Window closed. */
  readonly organizerTiebreak?: string | undefined;
}

export type GoalVoteResult =
  | { readonly outcome: 'shared'; readonly proposalId: string }
  | { readonly outcome: 'personal'; readonly reason: 'no_proposals' };

/**
 * Mode: a majority of the Ballots **cast** (PRD §8.2).
 *
 * A tie, or zero Ballots, resolves to `personal` — the fallback that requires no
 * further coordination (§8.3).
 */
export const resolveModeVote = (ballots: readonly CenterMode[]): CenterMode => {
  let shared = 0;
  let personal = 0;
  for (const ballot of ballots) {
    if (ballot === 'shared') shared++;
    else personal++;
  }
  return shared > personal ? 'shared' : 'personal';
};

/**
 * Family Goal: a plurality of the Ballots cast (PRD §9.2).
 *
 * Zero Proposals falls back to `personal` rather than leaving the Center Tile empty or
 * the Board unsealed (§9.3).
 *
 * **Ties.** PRD §9.2 and api.md §7 give the tiebreak to the Organizer; FRONTEND_DESIGN
 * §4.3 gives it to the earliest Proposal. Both are honoured in that order: the
 * Organizer's choice wins if they made one, and the earliest Proposal decides if they
 * did not. The fallback is not optional — `pg_cron` seals the Year on a deadline and
 * cannot wait for a tap that may never come (§8.4).
 */
export const resolveGoalVote = ({
  proposals,
  ballots,
  organizerTiebreak,
}: GoalVoteInput): GoalVoteResult => {
  if (proposals.length === 0) {
    return { outcome: 'personal', reason: 'no_proposals' };
  }

  const tally = new Map<string, number>(proposals.map((p) => [p.id, 0]));
  for (const ballot of ballots) {
    // A Ballot for a withdrawn Proposal is discarded, not counted against anyone.
    const current = tally.get(ballot);
    if (current !== undefined) tally.set(ballot, current + 1);
  }

  const best = Math.max(...tally.values());
  const leaders = proposals.filter((p) => tally.get(p.id) === best);

  if (leaders.length === 1) {
    return { outcome: 'shared', proposalId: leaders[0]!.id };
  }
  if (organizerTiebreak !== undefined && leaders.some((p) => p.id === organizerTiebreak)) {
    return { outcome: 'shared', proposalId: organizerTiebreak };
  }
  const earliest = leaders.reduce((a, b) => (b.order < a.order ? b : a));
  return { outcome: 'shared', proposalId: earliest.id };
};

/**
 * How many votes a Proposal has, in words.
 *
 * **Never "0".** §4.3 says so outright: zero reads "No votes yet". A nought beside
 * somebody's idea is a verdict on it, and the difference between "no votes yet" and "0"
 * is the difference between a family deciding and a family being scored.
 */
export const voteCountCopy = (votes: number): string => {
  if (votes <= 0) return 'No votes yet';
  return votes === 1 ? '1 vote' : `${votes} votes`;
};

/**
 * What the Centre would be if the window closed right now, said as a fact.
 *
 * Not a prediction and not a scoreboard — §4.3: "The outcome is stated as a fact, never
 * as a defeat." So it names the outcome and stops. It does not say who is winning, does
 * not say how far ahead, and above all does not say what is still needed, because "one
 * more vote for shared" is a call to lobby a family member (§8.4, §0.3).
 *
 * `personal` is the resting state, so it reads as the plan rather than as a failure to
 * agree: with no votes at all, a Family has not lost a vote, it simply has not had one.
 */
export const modeStandingCopy = (ballots: readonly CenterMode[]): string => {
  if (ballots.length === 0) return 'As it stands, everyone writes their own middle square.';
  return resolveModeVote(ballots) === 'shared'
    ? 'As it stands, you’ll share one goal in the middle.'
    : 'As it stands, everyone writes their own middle square.';
};

/**
 * The same for the Family Goal, once there are Proposals.
 *
 * Says which Goal it would be, and never why the others would not be. A tie is not
 * mentioned: it is resolved deterministically (earliest Proposal, or the Organizer's
 * pick) and announcing one only invites a scramble in its last hours.
 */
export const goalStandingCopy = (
  input: GoalVoteInput,
  textOf: (proposalId: string) => string | undefined,
): string => {
  const result = resolveGoalVote(input);
  if (result.outcome === 'personal') {
    return 'Nobody has put one forward yet, so everyone writes their own.';
  }
  const text = textOf(result.proposalId);
  return text === undefined
    ? 'As it stands, one of these goes in the middle.'
    : `As it stands, “${text}” goes in the middle.`;
};
