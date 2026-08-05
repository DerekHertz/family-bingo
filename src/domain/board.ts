/**
 * Turning the rows a Board query returns into the squares a Board renders.
 *
 * Three rules were living inside the Board screen's JSX, and all three are domain facts
 * rather than layout:
 *
 *   1. The shared Centre is a Goal like any other **once it is decided** — one row
 *      referenced by every Board, completed for everyone at once (§12.3).
 *   2. **The shared Centre takes no Increments.** `tile_is_loggable()` refuses them,
 *      because a Family Goal has no Target and is *marked* done rather than counted up.
 *      Anything deriving its progress from `COUNT(increments)` answers 0 forever — which
 *      silently makes the four Lines through the Centre, and Blackout (§13.3), unreachable.
 *   3. Which squares are complete, which is what `completedLines()` needs and what
 *      `completedPositions()` in `./milestones` already knows how to decide.
 *
 * Keeping them here means the screen asks a question instead of restating a rule, and that
 * `isCentre` is computed once and carried rather than re-derived from `familyGoalText` at
 * five separate call sites.
 *
 * Pure (PRD §13.6).
 */

import { completedPositions } from './milestones';

/** What a Goal looks like once it is on a square. Structural, so `lib/` can pass its own. */
export interface TileGoalShape {
  readonly text: string;
  readonly target: number;
  readonly unit: string | null;
}

/** One row of the Tiles query, narrowed to what drawing a square needs. */
export interface SourceTile {
  readonly id: string;
  readonly position: number;
  readonly goal: TileGoalShape | null;
  /** The Centre, once the vote has resolved to `shared` (§9.4). Not authored per Board. */
  readonly familyGoalText: string | null;
  /** When the Family marked the shared Goal done (§12.3) — the Centre's only signal. */
  readonly familyGoalCompletedAt: string | null;
}

/** A square, ready to render and ready to be asked whether it is complete. */
export interface RenderTile {
  readonly id: string;
  readonly position: number;
  readonly goal: TileGoalShape | null;
  readonly count: number;
  /** The **shared** Centre specifically — a personal centre is a square like any other. */
  readonly isCentre: boolean;
  /** Marked rather than counted (§12.3). The Centre's completion, and only the Centre's. */
  readonly markedComplete: boolean;
}

/**
 * The squares, given the Tiles and the live Increment counts.
 *
 * The shared Centre is handed a Target of 1 so the growth ladder has something to measure
 * against — it is done when the Family says it is, and there is no third state between
 * dormant and complete for a Goal with no counter. `markedComplete` carries the truth that
 * the synthetic Target cannot: a Centre at "0 of 1" is a Family Goal nobody has marked,
 * not a Goal one Increment away.
 */
export const renderTiles = (
  tiles: readonly SourceTile[],
  counts: Readonly<Record<string, number>>,
): RenderTile[] =>
  tiles.map((tile) => {
    const isCentre = tile.familyGoalText !== null;
    const markedComplete = isCentre && tile.familyGoalCompletedAt !== null;
    return {
      id: tile.id,
      position: tile.position,
      goal: isCentre
        ? { text: tile.familyGoalText ?? '', target: 1, unit: null }
        : tile.goal,
      count: isCentre ? (markedComplete ? 1 : 0) : (counts[tile.id] ?? 0),
      isCentre,
      markedComplete,
    };
  });

/**
 * The positions that are complete, ready for `completedLines()`.
 *
 * A thin adapter onto `completedPositions()` rather than a second fold, because that
 * function already holds the rule the Centre depends on — marked first, counted second —
 * and it is tested against the case where a Family Goal has no Target to fall back on.
 */
export const completedOn = (tiles: readonly RenderTile[]): Set<number> =>
  completedPositions(
    tiles.map((tile) => ({
      position: tile.position,
      count: tile.count,
      target: tile.goal?.target ?? null,
      markedComplete: tile.markedComplete,
    })),
  );
