import { describe, expect, it } from 'vitest';
import {
  AWARD_AXES,
  type MemberYearStats,
  assignAwards,
  axisScore,
} from './awards';

const member = (
  memberId: string,
  over: Partial<MemberYearStats> = {},
): MemberYearStats => ({
  memberId,
  increments: 0,
  biggestMonthIncrements: 0,
  medianGapDays: null,
  longestGoalSpanDays: null,
  comebackDelta: null,
  photos: 0,
  notes: 0,
  firstBingoAt: null,
  mostExceededRatio: null,
  completedALine: false,
  ...over,
});

/** A Member who did a bit of everything, scaled by `n`. */
const active = (id: string, n: number): MemberYearStats =>
  member(id, {
    increments: n,
    biggestMonthIncrements: Math.ceil(n / 4),
    medianGapDays: 30 / n,
    longestGoalSpanDays: n * 2,
    comebackDelta: n,
    photos: Math.floor(n / 3),
    notes: Math.floor(n / 2),
    firstBingoAt: new Date(2027, 5, n),
    mostExceededRatio: 1 + n / 100,
    completedALine: true,
  });

const holdersOf = (awards: ReturnType<typeof assignAwards>, axis: string) =>
  awards.filter((a) => a.axis === axis).map((a) => a.memberId);

const coverage = (awards: ReturnType<typeof assignAwards>) =>
  new Set(awards.map((a) => a.memberId));

describe('the award axes (§20.7)', () => {
  it('offers the ten suggested axes, all on unrelated measures', () => {
    expect([...AWARD_AXES]).toEqual([
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
    ]);
  });

  it('makes a Member ineligible for an axis they have no data on', () => {
    const nobody = member('a');
    for (const axis of AWARD_AXES) {
      if (axis === 'quietest_achiever') continue;
      expect(axisScore(axis, nobody)).toBeNull();
    }
  });

  it('scores Most Consistent by the smallest median gap, not the largest', () => {
    const steady = member('steady', { medianGapDays: 2 });
    const erratic = member('erratic', { medianGapDays: 40 });
    expect(axisScore('most_consistent', steady)!).toBeGreaterThan(
      axisScore('most_consistent', erratic)!,
    );
  });

  it('scores Quietest Achiever by the fewest Increments, and only for a completed Line', () => {
    const quiet = member('quiet', { increments: 8, completedALine: true });
    const loud = member('loud', { increments: 400, completedALine: true });
    const quietButNoLine = member('noline', { increments: 3, completedALine: false });
    expect(axisScore('quietest_achiever', quiet)!).toBeGreaterThan(
      axisScore('quietest_achiever', loud)!,
    );
    expect(axisScore('quietest_achiever', quietButNoLine)).toBeNull();
  });

  it('scores First Bingo by the earliest date', () => {
    const early = member('early', { firstBingoAt: new Date('2027-03-01') });
    const late = member('late', { firstBingoAt: new Date('2027-11-01') });
    expect(axisScore('first_bingo', early)!).toBeGreaterThan(
      axisScore('first_bingo', late)!,
    );
  });

  it('does not count a Goal merely met as Most Exceeded Target', () => {
    expect(axisScore('most_exceeded_target', member('a', { mostExceededRatio: 1 }))).toBeNull();
    expect(
      axisScore('most_exceeded_target', member('a', { mostExceededRatio: 1.4 })),
    ).not.toBeNull();
  });
});

describe('assignAwards — the naturally-earned awards', () => {
  it('gives an axis to the Member who genuinely leads it', () => {
    const awards = assignAwards([
      member('shutterbug', { increments: 10, photos: 40 }),
      member('writer', { increments: 10, notes: 60 }),
    ]);
    expect(holdersOf(awards, 'most_photos')).toEqual(['shutterbug']);
    expect(holdersOf(awards, 'most_notes')).toEqual(['writer']);
  });

  it('awards both on a tie (§20.7)', () => {
    const awards = assignAwards([
      member('a', { increments: 10, photos: 12 }),
      member('b', { increments: 10, photos: 12 }),
    ]);
    expect(holdersOf(awards, 'most_photos').sort()).toEqual(['a', 'b']);
  });

  it('names the leader with a superlative and anyone else with a plain fact', () => {
    const awards = assignAwards([
      member('most', { increments: 10, photos: 40 }),
      member('some', { increments: 10, photos: 4 }),
    ]);
    const leader = awards.find((a) => a.memberId === 'most' && a.axis === 'most_photos');
    expect(leader?.isSuperlative).toBe(true);
    expect(leader?.label).toMatch(/most/i);
  });

  it('returns nothing for a Family with no Members', () => {
    expect(assignAwards([])).toEqual([]);
  });

  it('gives a negated axis to the genuine leader, not to the worst Member', () => {
    // Regression: Most Consistent, First Bingo and Quietest Achiever score by negation
    // (smallest gap, earliest date, fewest Increments). Comparing raw scores as a ratio
    // inverts on those three — -40/-2 looks larger than -2/-2 — which handed the axis to
    // the LEAST consistent Member and left the real one without it.
    const steady = member('steady', { medianGapDays: 2 });
    const erratic = member('erratic', { medianGapDays: 40 });
    const awards = assignAwards([steady, erratic]);

    expect(holdersOf(awards, 'most_consistent')).toEqual(['steady']);
    expect(awards.find((a) => a.memberId === 'steady')?.isSuperlative).toBe(true);
  });

  it('gives First Bingo to the earliest, not the latest', () => {
    const early = member('early', { firstBingoAt: new Date('2027-03-01') });
    const late = member('late', { firstBingoAt: new Date('2027-11-01') });
    expect(holdersOf(assignAwards([early, late]), 'first_bingo')).toEqual(['early']);
  });

  it('gives Quietest Achiever to the quietest Member who closed a Line', () => {
    const quiet = member('quiet', { increments: 8, completedALine: true });
    const loud = member('loud', { increments: 90, completedALine: true });
    const awards = assignAwards([quiet, loud]);
    expect(holdersOf(awards, 'quietest_achiever')).toEqual(['quiet']);
  });

  it('never lets a Member hold an axis while someone strictly better is unnamed on it', () => {
    // The property the ratio bug violated: if an axis is awarded at all, whoever holds
    // it is either its outright best, or was given it for coverage while the outright
    // best already holds an Award of their own (§20.7).
    let seed = 13579;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 200; trial++) {
      const size = 2 + Math.floor(next() * 8);
      const family = Array.from({ length: size }, (_, i) =>
        active(`m${i}`, 1 + Math.floor(next() * 150)),
      );
      const byId = new Map(family.map((m) => [m.memberId, m]));
      const awards = assignAwards(family);
      const covered = coverage(awards);
      for (const axis of AWARD_AXES) {
        const holders = holdersOf(awards, axis);
        if (holders.length === 0) continue;
        const held = axisScore(axis, byId.get(holders[0]!)!)!;
        for (const m of family) {
          const score = axisScore(axis, m);
          if (score !== null && score > held) {
            expect(covered.has(m.memberId)).toBe(true);
          }
        }
      }
    }
  });
});

describe('assignAwards — every Member receives at least one (§20.7, ADR-0006)', () => {
  it('covers a family of six where one person barely played', () => {
    // The exact case ADR-0006 names as the failure a naive implementation hits.
    const family = [
      active('mum', 400),
      active('dad', 300),
      active('theo', 120),
      active('ada', 90),
      active('gran', 30),
      member('quiet-kid', { increments: 2, biggestMonthIncrements: 2 }),
    ];
    const awards = assignAwards(family);
    for (const m of family) {
      expect(coverage(awards).has(m.memberId)).toBe(true);
    }
  });

  it('covers everyone even when one Member sweeps every natural axis', () => {
    // A single dominant Member is what exhausts the axis pool.
    const sweeper = active('sweeper', 1000);
    const family = [
      sweeper,
      active('b', 50),
      active('c', 40),
      active('d', 30),
      active('e', 20),
      active('f', 10),
    ];
    const awards = assignAwards(family);
    expect(coverage(awards).size).toBe(6);
  });

  it('covers a Member who logged absolutely nothing all Year', () => {
    const awards = assignAwards([active('a', 100), member('ghost')]);
    expect(coverage(awards).has('ghost')).toBe(true);
  });

  it('covers a Family larger than the axis pool', () => {
    // 20 Members to a Family (FRONTEND_DESIGN §4.5), 10 axes.
    const family = Array.from({ length: 20 }, (_, i) => active(`m${i}`, 200 - i * 7));
    const awards = assignAwards(family);
    expect(coverage(awards).size).toBe(20);
  });

  it('hands out at least as many Awards as there are Members (§20.7)', () => {
    for (const size of [1, 2, 3, 6, 11, 20]) {
      const family = Array.from({ length: size }, (_, i) => active(`m${i}`, 100 - i * 3));
      const awards = assignAwards(family);
      expect(awards.length).toBeGreaterThanOrEqual(size);
    }
  });

  it('covers everyone across many randomly-shaped Families', () => {
    let seed = 987654321;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 300; trial++) {
      const size = 1 + Math.floor(next() * 12);
      const family = Array.from({ length: size }, (_, i) => {
        const n = Math.floor(next() * 200);
        return n === 0 ? member(`m${i}`) : active(`m${i}`, n);
      });
      const awards = assignAwards(family);
      const covered = coverage(awards);
      for (const m of family) {
        expect(covered.has(m.memberId)).toBe(true);
      }
      expect(awards.length).toBeGreaterThanOrEqual(size);
    }
  });
});

describe('assignAwards — never a ladder (§13.5a, ADR-0006)', () => {
  it('never puts two Members on one axis unless they genuinely tie', () => {
    // This is the property that keeps an axis from becoming "1st, 2nd, 3rd".
    let seed = 424242;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 200; trial++) {
      const size = 2 + Math.floor(next() * 10);
      const family = Array.from({ length: size }, (_, i) =>
        active(`m${i}`, 1 + Math.floor(next() * 200)),
      );
      const byId = new Map(family.map((m) => [m.memberId, m]));
      const awards = assignAwards(family);
      for (const axis of AWARD_AXES) {
        const holders = holdersOf(awards, axis);
        const scores = new Set(holders.map((id) => axisScore(axis, byId.get(id)!)));
        expect(scores.size).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives a Member at most one Award per axis (schema constraint)', () => {
    const family = Array.from({ length: 6 }, (_, i) => active(`m${i}`, 100 - i * 9));
    const awards = assignAwards(family);
    const seen = new Set<string>();
    for (const a of awards) {
      const key = `${a.memberId}/${a.axis}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('is deterministic — Wrapped is generated once and must never differ on a re-run', () => {
    const family = [active('a', 90), active('b', 90), active('c', 12), member('d')];
    const first = assignAwards(family);
    for (let n = 0; n < 10; n++) {
      expect(assignAwards(family)).toEqual(first);
    }
  });

  it('does not depend on the order Members are passed in', () => {
    const family = [active('a', 90), active('b', 40), active('c', 12), member('d')];
    const forwards = assignAwards(family);
    const backwards = assignAwards([...family].reverse());
    const key = (a: { memberId: string; axis: string }) => `${a.memberId}/${a.axis}`;
    expect(new Set(forwards.map(key))).toEqual(new Set(backwards.map(key)));
  });

  it('carries the underlying number so the card states a fact, not a standing', () => {
    const awards = assignAwards([member('a', { increments: 47, photos: 3 })]);
    const increments = awards.find((a) => a.axis === 'most_increments');
    expect(increments?.detail).toEqual({ increments: 47 });
  });
});
