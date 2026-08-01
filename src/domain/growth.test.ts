import { describe, expect, it } from 'vitest';
import { isTileComplete, progressOf, stageOf } from './growth';

describe('isTileComplete', () => {
  it('completes when the Increment count reaches the Target (§12.1)', () => {
    expect(isTileComplete(2, 3)).toBe(false);
    expect(isTileComplete(3, 3)).toBe(true);
  });

  it('treats target = 1 as the one-shot shape — no separate type (§6.2)', () => {
    expect(isTileComplete(0, 1)).toBe(false);
    expect(isTileComplete(1, 1)).toBe(true);
  });

  it('stays complete past the Target', () => {
    expect(isTileComplete(160, 150)).toBe(true);
  });
});

describe('progressOf', () => {
  it('is the fraction of the Target reached', () => {
    expect(progressOf(75, 150)).toBe(0.5);
    expect(progressOf(0, 150)).toBe(0);
  });

  it('clamps at 1 — overshoot is never shown on the Board (§2)', () => {
    // 160 of 150 renders exactly as 150. Overshoot is celebrated once, in Wrapped.
    expect(progressOf(160, 150)).toBe(1);
    expect(progressOf(1000, 1)).toBe(1);
  });

  it('clamps at 0 rather than going negative', () => {
    expect(progressOf(-5, 150)).toBe(0);
  });

  it('never returns NaN for a Target of 0, even though the schema forbids one', () => {
    expect(progressOf(0, 0)).toBe(1);
    expect(progressOf(-1, 0)).toBe(0);
  });
});

describe('stageOf', () => {
  it('is dormant at zero — and looks identical after four months (§0.3)', () => {
    expect(stageOf(0, 150)).toBe('dormant');
    expect(stageOf(0, 1)).toBe('dormant');
  });

  it('is dormant rather than throwing on a negative count', () => {
    expect(stageOf(-1, 150)).toBe('dormant');
  });

  it('is seeded from the first Increment up to 17%', () => {
    expect(stageOf(1, 150)).toBe('seeded');
    expect(stageOf(26, 150)).toBe('seeded'); // 17.3%
  });

  it('is sprouting from 18% to 81%', () => {
    expect(stageOf(27, 150)).toBe('sprouting'); // 18%
    expect(stageOf(122, 150)).toBe('sprouting'); // 81.3%
  });

  it('is budding from 82% to 99% — the only warm mark on an unfinished Board', () => {
    expect(stageOf(123, 150)).toBe('budding'); // 82%
    expect(stageOf(149, 150)).toBe('budding');
  });

  it('is complete at the Target and stays there past it', () => {
    expect(stageOf(150, 150)).toBe('complete');
    expect(stageOf(160, 150)).toBe('complete');
  });

  it('puts the boundaries on the documented side', () => {
    expect(stageOf(18, 100)).toBe('sprouting'); // exactly 0.18 is sprouting
    expect(stageOf(17, 100)).toBe('seeded');
    expect(stageOf(82, 100)).toBe('budding'); // exactly 0.82 is budding
    expect(stageOf(81, 100)).toBe('sprouting');
  });

  it('takes a one-shot Goal straight from dormant to complete', () => {
    // A target of 1 has no intermediate stage to show.
    expect(stageOf(0, 1)).toBe('dormant');
    expect(stageOf(1, 1)).toBe('complete');
  });

  it('agrees with isTileComplete everywhere', () => {
    for (let target = 1; target <= 40; target++) {
      for (let count = 0; count <= target + 3; count++) {
        expect(stageOf(count, target) === 'complete').toBe(
          isTileComplete(count, target),
        );
      }
    }
  });

  it('never regresses as Increments accumulate', () => {
    const order = ['dormant', 'seeded', 'sprouting', 'budding', 'complete'];
    for (let target = 1; target <= 40; target++) {
      let seen = 0;
      for (let count = 0; count <= target + 3; count++) {
        const rank = order.indexOf(stageOf(count, target));
        expect(rank).toBeGreaterThanOrEqual(seen);
        seen = rank;
      }
    }
  });
});
