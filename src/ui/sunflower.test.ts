import { describe, expect, it } from 'vitest';
import { HEAD_SIZE, LEAF_APPEARS_AT, PETAL_SPREAD, discOf, petalsOf, stemOf } from './sunflower';
import { stageOf } from '../domain/growth';

describe('petalsOf (§2)', () => {
  it('draws eight petals at a 45 degree period', () => {
    const petals = petalsOf(HEAD_SIZE.complete, PETAL_SPREAD.complete);
    expect(petals).toHaveLength(8);
    expect(petals.map((p) => p.rotation)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('widens from budding to complete, which is the whole animation', () => {
    const budding = petalsOf(HEAD_SIZE.complete, PETAL_SPREAD.budding)[0]!;
    const complete = petalsOf(HEAD_SIZE.complete, PETAL_SPREAD.complete)[0]!;
    // The ANGULAR extent grows. `width` is radial length and must not move, or the flower
    // lengthens instead of opening.
    expect(complete.height).toBeGreaterThan(budding.height);
    expect(budding.height / complete.height).toBeCloseTo(26 / 32, 5);
    expect(budding.width).toBe(complete.width);
  });

  it('scales every dimension with the head, so one component serves both sizes', () => {
    const small = petalsOf(HEAD_SIZE.budding, PETAL_SPREAD.budding)[0]!;
    const large = petalsOf(HEAD_SIZE.complete, PETAL_SPREAD.budding)[0]!;
    const ratio = HEAD_SIZE.complete / HEAD_SIZE.budding;
    expect(large.width / small.width).toBeCloseTo(ratio, 5);
    expect(large.height / small.height).toBeCloseTo(ratio, 5);
    expect(large.offset / small.offset).toBeCloseTo(ratio, 5);
  });

  it('keeps the disc inside the petals at both sizes', () => {
    for (const size of [HEAD_SIZE.budding, HEAD_SIZE.complete]) {
      const disc = discOf(size);
      const petal = petalsOf(size, PETAL_SPREAD.complete)[0]!;
      expect(disc.size).toBeLessThan(size);
      // The petal reaches further out than the disc's edge, or it would be swallowed.
      expect(petal.offset + petal.width / 2).toBeGreaterThan(disc.size / 2);
    }
  });
});

describe('stemOf (§2) — the leaf is positioned against the stem, never the tile', () => {
  it('touches the stem at every progress value a leaf is drawn at', () => {
    for (let p = LEAF_APPEARS_AT; p <= 1.0001; p += 0.01) {
      const { stemHeight, leafSize, leafBottom } = stemOf(p);
      // The leaf's span must sit wholly within the stem's, or it floats off the end.
      expect(leafBottom).toBeGreaterThanOrEqual(9);
      expect(leafBottom + leafSize).toBeLessThanOrEqual(9 + stemHeight + 0.0001);
    }
  });

  it('clears the flower head once it opens at 82%', () => {
    for (let p = 0.82; p <= 1.0001; p += 0.01) {
      const { leafSize, leafBottom, headBottom } = stemOf(p);
      expect(leafBottom + leafSize).toBeLessThanOrEqual(headBottom + 0.0001);
    }
  });

  it('holds the leaf between 9 and 12pt, so it reads at tile scale', () => {
    for (let p = LEAF_APPEARS_AT; p <= 1.0001; p += 0.01) {
      const { leafSize } = stemOf(p);
      expect(leafSize).toBeGreaterThanOrEqual(9);
      expect(leafSize).toBeLessThanOrEqual(12);
    }
  });

  it('grows the stem monotonically from 7 to 27pt', () => {
    expect(stemOf(0).stemHeight).toBe(7);
    expect(stemOf(1).stemHeight).toBe(27);
    let previous = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const { stemHeight } = stemOf(p);
      expect(stemHeight).toBeGreaterThanOrEqual(previous);
      previous = stemHeight;
    }
  });

  it('clamps out of range progress rather than drawing past the tile', () => {
    // 160 of 150 renders exactly as 150 — overshoot is celebrated once, in Wrapped.
    expect(stemOf(1.6)).toEqual(stemOf(1));
    expect(stemOf(-0.5)).toEqual(stemOf(0));
  });
});

describe('LEAF_APPEARS_AT agrees with the growth ladder', () => {
  it('is exactly where stageOf stops drawing a seed and starts drawing a stem', () => {
    // §2's table: seeded is 1-17%, sprouting is 18-81%. The leaf belongs to sprouting, so
    // this constant and that threshold have to be the same number or one of them is wrong.
    expect(stageOf(Math.round(LEAF_APPEARS_AT * 100), 100)).toBe('sprouting');
    expect(stageOf(Math.round(LEAF_APPEARS_AT * 100) - 1, 100)).toBe('seeded');
  });

  it('is the point below which the centring arithmetic would float the leaf', () => {
    // Documenting the boundary rather than guarding it: below sprouting the stem is
    // shorter than the leaf's 9pt floor, so the leaf's base drops beneath the stem's.
    const below = stemOf(0.05);
    expect(below.leafBottom).toBeLessThan(9);

    const atThreshold = stemOf(LEAF_APPEARS_AT);
    expect(atThreshold.leafBottom).toBeGreaterThanOrEqual(9);
  });
});
