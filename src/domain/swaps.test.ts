import { describe, expect, it } from 'vitest';
import {
  SWAP_BUDGET,
  type GoalRewriteContext,
  costOfRewrite,
  evaluateGoalRewrite,
  swapsRemaining,
} from './swaps';

const sealed = (over: Partial<GoalRewriteContext> = {}): GoalRewriteContext => ({
  sealed: true,
  frozen: false,
  swapsUsed: 0,
  isSharedCenter: false,
  isComplete: false,
  ...over,
});

describe('the Swap budget', () => {
  it('is three per Member per Year (§18.1)', () => {
    expect(SWAP_BUDGET).toBe(3);
  });

  it('counts down and never goes negative', () => {
    expect(swapsRemaining(0)).toBe(3);
    expect(swapsRemaining(2)).toBe(1);
    expect(swapsRemaining(3)).toBe(0);
    expect(swapsRemaining(9)).toBe(0);
  });
});

describe('costOfRewrite (§18.2, §18.3)', () => {
  it('charges for replacing the Goal text', () => {
    expect(
      costOfRewrite({ text: 'Read 12 books', target: 12 }, { text: 'Run a 10k', target: 12 }),
    ).toBe('swap');
  });

  it('charges for lowering the Target', () => {
    expect(
      costOfRewrite({ text: 'Walk', target: 144 }, { text: 'Walk', target: 90 }),
    ).toBe('swap');
  });

  it('lets a Member raise a Target for free — making a Goal harder needs no policing (§18.3)', () => {
    expect(
      costOfRewrite({ text: 'Walk', target: 144 }, { text: 'Walk', target: 200 }),
    ).toBe('free');
  });

  it('charges for filling an empty Tile on an unfinished sealed Board (§18.5)', () => {
    expect(costOfRewrite(null, { text: 'Learn to swim', target: 1 })).toBe('swap');
  });

  it('charges nothing when nothing changed', () => {
    expect(
      costOfRewrite({ text: 'Walk', target: 144 }, { text: 'Walk', target: 144 }),
    ).toBe('none');
  });

  it('charges once, not twice, when text and Target both change', () => {
    expect(
      costOfRewrite({ text: 'Walk', target: 144 }, { text: 'Swim', target: 20 }),
    ).toBe('swap');
  });

  it('charges for a text change even when the Target rises', () => {
    expect(
      costOfRewrite({ text: 'Walk', target: 144 }, { text: 'Swim', target: 200 }),
    ).toBe('swap');
  });

  it('does not treat surrounding whitespace as a rewrite', () => {
    expect(
      costOfRewrite({ text: 'Walk', target: 12 }, { text: '  Walk  ', target: 12 }),
    ).toBe('none');
  });
});

describe('evaluateGoalRewrite', () => {
  it('allows the Swap in the acceptance test and spends one from the budget', () => {
    const decision = evaluateGoalRewrite(
      sealed({ swapsUsed: 0 }),
      { text: 'Read 12 books', target: 12 },
      { text: 'Run a 10k', target: 1 },
    );
    expect(decision).toEqual({ allowed: true, cost: 'swap', swapsRemainingAfter: 2 });
  });

  it('rejects a Swap when the budget is spent (§18.1)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ swapsUsed: SWAP_BUDGET }),
      { text: 'Walk', target: 144 },
      { text: 'Swim', target: 20 },
    );
    expect(decision).toEqual({ allowed: false, reason: 'budget_exhausted' });
  });

  it('still allows a free Target raise with the budget spent (§18.3)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ swapsUsed: SWAP_BUDGET }),
      { text: 'Walk', target: 144 },
      { text: 'Walk', target: 200 },
    );
    expect(decision).toEqual({ allowed: true, cost: 'free', swapsRemainingAfter: 0 });
  });

  it('charges nothing on a draft Board — everything before Sealing is free editing (§6.4)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ sealed: false }),
      { text: 'Walk', target: 144 },
      { text: 'Swim', target: 20 },
    );
    expect(decision).toEqual({ allowed: true, cost: 'free', swapsRemainingAfter: 3 });
  });

  it('refuses to touch a shared Center Tile — it sits on every Board (FRONTEND_DESIGN §4.4)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ isSharedCenter: true }),
      { text: 'Camping trip', target: 1 },
      { text: 'Beach trip', target: 1 },
    );
    expect(decision).toEqual({ allowed: false, reason: 'shared_center_tile' });
  });

  it('refuses to swap a Tile that is already complete (FRONTEND_DESIGN §4.4)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ isComplete: true }),
      { text: 'Walk', target: 144 },
      { text: 'Swim', target: 20 },
    );
    expect(decision).toEqual({ allowed: false, reason: 'tile_complete' });
  });

  it('allows a Swap on a Tile at 97% — everything unfinished is fair game (FRONTEND_DESIGN §4.4)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ isComplete: false }),
      { text: 'Walk', target: 150 },
      { text: 'Swim', target: 20 },
    );
    expect(decision).toEqual({ allowed: true, cost: 'swap', swapsRemainingAfter: 2 });
  });

  it('refuses everything once the Year is frozen (§20.1)', () => {
    const decision = evaluateGoalRewrite(
      sealed({ frozen: true }),
      { text: 'Walk', target: 144 },
      { text: 'Walk', target: 200 },
    );
    expect(decision).toEqual({ allowed: false, reason: 'year_frozen' });
  });

  it('does not spend a Swap on a no-op', () => {
    const decision = evaluateGoalRewrite(
      sealed({ swapsUsed: 1 }),
      { text: 'Walk', target: 144 },
      { text: 'Walk', target: 144 },
    );
    expect(decision).toEqual({ allowed: true, cost: 'none', swapsRemainingAfter: 2 });
  });

  it('spends the budget down to zero across three Swaps and refuses the fourth', () => {
    const costs = [0, 1, 2, 3].map((swapsUsed) =>
      evaluateGoalRewrite(
        sealed({ swapsUsed }),
        { text: 'Walk', target: 144 },
        { text: 'Swim', target: 20 },
      ),
    );
    expect(costs.map((c) => (c.allowed ? c.swapsRemainingAfter : c.reason))).toEqual([
      2,
      1,
      0,
      'budget_exhausted',
    ]);
  });
});
