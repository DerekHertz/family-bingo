/**
 * Wrapped Awards — the one bounded exception to the no-ranking rule (PRD §13.5a,
 * ADR-0006).
 *
 * Three constraints keep this from becoming a leaderboard. Remove any one of them and
 * the decision has been reversed:
 *
 *   1. Awards sit on **unrelated axes**, so nobody can sweep by setting easy Goals.
 *   2. **Every Member receives at least one.** A family of six where one person gets
 *      nothing is the failure this module exists to prevent.
 *   3. **There is never a single ordered list.** An Award names one person on one axis;
 *      it never implies a standing.
 *
 * The tension is between (1) and (2): if one very active Member is the strict maximum of
 * nine axes, the pool is exhausted and four people get nothing. This is resolved by
 * assigning axes **for coverage first** — the most constrained Member picks first — so a
 * dominant Member keeps only the axes nobody else can claim. A Member named on an axis
 * they do not strictly lead gets a factual label rather than a superlative one, and
 * `detail` always carries the raw number, so no card ever states something untrue.
 *
 * Pure, and deterministic: Wrapped is generated once at Freeze and materialized
 * (PRD §20.2), so a re-run must produce byte-identical output.
 */

export type AwardAxis =
  | 'most_increments'
  | 'biggest_single_month'
  | 'most_consistent'
  | 'longest_running_goal'
  | 'best_comeback'
  | 'most_photos'
  | 'most_notes'
  | 'first_bingo'
  | 'most_exceeded_target'
  | 'quietest_achiever'
  /** The floor: a Member the ten comparative axes cannot reach. Never comparative. */
  | 'showed_up';

/** The ten comparative axes, in the order PRD §20.7 lists them. */
export const AWARD_AXES = [
  'most_increments',
  'biggest_single_month',
  'most_consistent',
  'longest_running_goal',
  'best_comeback',
  'most_photos',
  'most_notes',
  'first_bingo',
  'most_exceeded_target',
  'quietest_achiever',
] as const satisfies readonly AwardAxis[];

/** One Member's Year, reduced to the numbers the axes compare. */
export interface MemberYearStats {
  readonly memberId: string;
  readonly increments: number;
  readonly biggestMonthIncrements: number;
  /** Median days between consecutive Increments. Smallest wins. */
  readonly medianGapDays: number | null;
  /** First-to-last Increment span on a single Goal, in days. */
  readonly longestGoalSpanDays: number | null;
  /** Best month minus worst month. */
  readonly comebackDelta: number | null;
  readonly photos: number;
  readonly notes: number;
  readonly firstBingoAt: Date | null;
  /** The largest `count / target` across the Member's completed Goals. */
  readonly mostExceededRatio: number | null;
  readonly completedALine: boolean;
}

export interface Award {
  readonly memberId: string;
  readonly axis: AwardAxis;
  readonly label: string;
  /**
   * True when this Member is the outright best on the axis, which is what earns the
   * superlative wording. False means the card states a plain fact instead — never a
   * placing, and never a number relative to anyone else (§13.5a).
   */
  readonly isSuperlative: boolean;
  readonly detail: Record<string, number | string>;
}

interface AxisSpec {
  readonly superlative: string;
  readonly factual: string;
  /** Higher is better. `null` means the Member is not eligible for this axis. */
  readonly score: (s: MemberYearStats) => number | null;
  readonly detail: (s: MemberYearStats) => Record<string, number | string>;
}

const SPECS: Record<(typeof AWARD_AXES)[number], AxisSpec> = {
  most_increments: {
    superlative: 'Most Increments',
    factual: 'Kept At It',
    score: (s) => (s.increments > 0 ? s.increments : null),
    detail: (s) => ({ increments: s.increments }),
  },
  biggest_single_month: {
    superlative: 'Biggest Single Month',
    factual: 'A Very Good Month',
    score: (s) => (s.biggestMonthIncrements > 0 ? s.biggestMonthIncrements : null),
    detail: (s) => ({ increments: s.biggestMonthIncrements }),
  },
  most_consistent: {
    superlative: 'Most Consistent',
    factual: 'Steady Hand',
    // Smallest median gap wins, so the score is negated.
    score: (s) => (s.medianGapDays === null ? null : -s.medianGapDays),
    detail: (s) => ({ medianGapDays: s.medianGapDays ?? 0 }),
  },
  longest_running_goal: {
    superlative: 'Longest-Running Goal',
    factual: 'The Long Haul',
    score: (s) =>
      s.longestGoalSpanDays !== null && s.longestGoalSpanDays > 0
        ? s.longestGoalSpanDays
        : null,
    detail: (s) => ({ days: s.longestGoalSpanDays ?? 0 }),
  },
  best_comeback: {
    superlative: 'Best Comeback',
    factual: 'Found Their Feet',
    score: (s) => (s.comebackDelta !== null && s.comebackDelta > 0 ? s.comebackDelta : null),
    detail: (s) => ({ increments: s.comebackDelta ?? 0 }),
  },
  most_photos: {
    superlative: 'Most Photos',
    factual: 'Behind the Camera',
    score: (s) => (s.photos > 0 ? s.photos : null),
    detail: (s) => ({ photos: s.photos }),
  },
  most_notes: {
    superlative: 'Most Notes Written',
    factual: 'Had Things To Say',
    score: (s) => (s.notes > 0 ? s.notes : null),
    detail: (s) => ({ notes: s.notes }),
  },
  first_bingo: {
    superlative: 'First Bingo',
    factual: 'Closed a Line',
    // Earliest wins, so the score is negated.
    score: (s) => (s.firstBingoAt === null ? null : -s.firstBingoAt.getTime()),
    detail: (s) => ({ at: s.firstBingoAt?.toISOString() ?? '' }),
  },
  most_exceeded_target: {
    superlative: 'Most Exceeded Target',
    factual: 'Went Past the Number',
    score: (s) =>
      s.mostExceededRatio !== null && s.mostExceededRatio > 1 ? s.mostExceededRatio : null,
    detail: (s) => ({ ratio: s.mostExceededRatio ?? 1 }),
  },
  quietest_achiever: {
    superlative: 'Quietest Achiever',
    factual: 'No Fuss',
    // Fewest Increments, but only for a Member who still closed a Line.
    score: (s) => (s.completedALine ? -s.increments : null),
    detail: (s) => ({ increments: s.increments }),
  },
};

/** A Member's standing on one axis. Higher is better; `null` means ineligible. */
export const axisScore = (axis: AwardAxis, stats: MemberYearStats): number | null =>
  axis === 'showed_up' ? 0 : SPECS[axis].score(stats);

const awardFor = (
  axis: (typeof AWARD_AXES)[number],
  stats: MemberYearStats,
  isSuperlative: boolean,
): Award => ({
  memberId: stats.memberId,
  axis,
  label: isSuperlative ? SPECS[axis].superlative : SPECS[axis].factual,
  isSuperlative,
  detail: SPECS[axis].detail(stats),
});

/**
 * Assign Awards across a Family's Year.
 *
 * Coverage-first: at each step the Member with the fewest remaining eligible axes takes
 * their strongest available one, together with anyone tied at exactly that score (§20.7,
 * "ties: award both"). Once every Member is covered, any axes still unused go to their
 * strongest eligible Member, which is what produces "at least as many Awards as
 * Members". A Member the ten axes cannot reach at all receives `showed_up`.
 *
 * Deterministic under any input ordering: Members are considered in `memberId` order and
 * axes in the constant order of `AWARD_AXES`.
 */
export const assignAwards = (family: readonly MemberYearStats[]): Award[] => {
  const members = [...family].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
  if (members.length === 0) return [];

  const strictBest = new Map<AwardAxis, number>();
  // Standing is a RANK, 1 = best, never a ratio of scores. Three axes score by negation
  // — smallest median gap, earliest Bingo, fewest Increments — and on those a ratio
  // inverts: -40 / -2 looks larger than -2 / -2, which handed "Most Consistent" to the
  // least consistent Member. A rank is sign-agnostic and cannot do that.
  const rankOn = new Map<AwardAxis, Map<string, number>>();

  for (const axis of AWARD_AXES) {
    const eligible = members
      .flatMap((m) => {
        const score = axisScore(axis, m);
        return score === null ? [] : [{ memberId: m.memberId, score }];
      })
      .sort((a, b) => b.score - a.score || (a.memberId < b.memberId ? -1 : 1));

    if (eligible.length > 0) strictBest.set(axis, eligible[0]!.score);

    const ranks = new Map<string, number>();
    eligible.forEach((entry, index) => {
      const previous = eligible[index - 1];
      // Members on the same score share a rank, so a tie stays a tie.
      ranks.set(
        entry.memberId,
        previous !== undefined && previous.score === entry.score
          ? ranks.get(previous.memberId)!
          : index + 1,
      );
    });
    rankOn.set(axis, ranks);
  }

  const awards: Award[] = [];
  const covered = new Set<string>();
  const usedAxes = new Set<AwardAxis>();

  const availableAxesFor = (m: MemberYearStats) =>
    AWARD_AXES.filter((axis) => !usedAxes.has(axis) && axisScore(axis, m) !== null);

  // Coverage phase — the most constrained Member always picks first, so a dominant
  // Member is left holding only the axes nobody else could have claimed.
  for (;;) {
    const waiting = members
      .filter((m) => !covered.has(m.memberId))
      .flatMap((m) => {
        const axes = availableAxesFor(m);
        if (axes.length === 0) return [];
        // The axis they stand highest on. Ranks are comparable across axes measured in
        // different units; raw scores are not. Ties break on the constant axis order.
        let bestAxis = axes[0]!;
        let bestRank = Infinity;
        for (const axis of axes) {
          const rank = rankOn.get(axis)!.get(m.memberId)!;
          if (rank < bestRank) {
            bestRank = rank;
            bestAxis = axis;
          }
        }
        return [{ member: m, choices: axes.length, bestAxis, bestRank }];
      });
    if (waiting.length === 0) break;

    // Most constrained first, so a dominant Member is left holding only the axes nobody
    // else could have claimed. Where two Members are equally constrained, the one who
    // stands higher picks first — otherwise the genuine leader of an axis can lose it to
    // whoever happens to sort earlier.
    let pick = waiting[0]!;
    for (const candidate of waiting) {
      if (
        candidate.choices < pick.choices ||
        (candidate.choices === pick.choices && candidate.bestRank < pick.bestRank)
      ) {
        pick = candidate;
      }
    }
    const bestAxis = pick.bestAxis;

    const winningScore = axisScore(bestAxis, pick.member)!;
    const isSuperlative = strictBest.get(bestAxis) === winningScore;
    for (const m of members) {
      // Ties award both, and only an exact tie counts.
      if (axisScore(bestAxis, m) === winningScore) {
        awards.push(awardFor(bestAxis, m, isSuperlative));
        covered.add(m.memberId);
      }
    }
    usedAxes.add(bestAxis);
  }

  // Leftover phase — axes nobody needed for coverage still go to whoever leads them.
  for (const axis of AWARD_AXES) {
    if (usedAxes.has(axis)) continue;
    const best = strictBest.get(axis);
    if (best === undefined) continue;
    for (const m of members) {
      if (axisScore(axis, m) === best) {
        awards.push(awardFor(axis, m, true));
        covered.add(m.memberId);
      }
    }
    usedAxes.add(axis);
  }

  // The floor. A Member who logged nothing all Year is eligible for no comparative axis;
  // §20.7 still guarantees them an Award, and this one claims nothing about anyone else.
  for (const m of members) {
    if (covered.has(m.memberId)) continue;
    awards.push({
      memberId: m.memberId,
      axis: 'showed_up',
      label: 'Showed Up',
      isSuperlative: false,
      detail: { increments: m.increments },
    });
    covered.add(m.memberId);
  }

  /* istanbul ignore next -- the invariant §20.7 exists to protect; unreachable by design */
  if (covered.size !== members.length) {
    throw new Error('Wrapped: every Member must receive at least one Award (PRD §20.7)');
  }

  return awards;
};
