/**
 * The growth ladder — how far along a Tile is, derived from its Increment count and its
 * Target on every render and never stored as a flag (PRD §12.1, schema.md §3.1).
 *
 * Pure, no imports, unit-tested exhaustively (FRONTEND_DESIGN §2).
 */

export type Stage = 'dormant' | 'seeded' | 'sprouting' | 'budding' | 'complete';

/** A Tile is complete when its Increments reach its Target (PRD §12.1). */
export const isTileComplete = (count: number, target: number): boolean =>
  count >= target;

/**
 * Continuous 0–1, used for fill height and stem length.
 *
 * Clamped at both ends. Past 100% nothing happens: 160 of 150 renders exactly as 150,
 * because showing overshoot on the Board would quietly re-introduce the ladder that
 * PRD §13.5 forbids. Overshoot is celebrated once, in Wrapped (§20.4).
 */
export const progressOf = (count: number, target: number): number => {
  if (count >= target) return 1;
  if (count <= 0) return 0;
  return count / target;
};

/**
 * Which rung of the growth ladder a Tile is on.
 *
 * A dormant Tile looks identical whether it has been dormant four days or four months
 * — nothing in this system scolds (FRONTEND_DESIGN §0.3).
 */
export const stageOf = (count: number, target: number): Stage => {
  if (count >= target) return 'complete';
  if (count <= 0) return 'dormant';
  const p = count / target;
  if (p < 0.18) return 'seeded';
  if (p < 0.82) return 'sprouting';
  return 'budding';
};
