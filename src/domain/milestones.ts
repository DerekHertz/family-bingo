/**
 * Which Milestones a Board owes, given where it stands and what has already been
 * recorded.
 *
 * The whole function is a diff against the `milestones` table rather than a reaction to
 * a write, which is what makes it idempotent: replaying a queue of offline Increments
 * (PRD §17.4) re-derives the same state and emits nothing the second time. The client
 * gates its completion animation on the Milestone insert for the same reason
 * (FRONTEND_DESIGN §5).
 *
 * Pure (PRD §13.6).
 */

import { completedLines, isBlackout } from './lines';
import { isTileComplete } from './growth';

export type MilestoneType = 'tile_completed' | 'bingo' | 'line_completed' | 'blackout';

/** A Tile as the database sees it: a position, a live Increment count, and a Target. */
export interface BoardTile {
  readonly position: number;
  /** `COUNT(increments)`. Never a cached field (PRD §11.4). */
  readonly count: number;
  /** `null` for an unfilled Tile on a sealed Board (PRD §10.2). */
  readonly target: number | null;
  /**
   * The shared Center Tile, completed by being marked rather than counted up.
   *
   * A Family Goal has no Target — any Member marks it done and it completes for every
   * Member at once (PRD §12.3), which is why `family_goals` carries `completed_at` and
   * no counter. Counting cannot decide this Tile, so the database states it outright.
   * Without it, position 12 could never join `done`, and the four Lines through the
   * centre and Blackout would be unreachable for every shared-mode Family.
   */
  readonly markedComplete?: boolean;
}

/** What the `milestones` table already holds for this Member and Year. */
export interface RecordedMilestones {
  readonly tilePositions: ReadonlySet<number>;
  readonly lineIndexes: ReadonlySet<number>;
  readonly blackout: boolean;
}

export interface PendingMilestone {
  readonly type: MilestoneType;
  readonly position?: number;
  readonly lineIndex?: number;
}

export const nothingRecorded = (): RecordedMilestones => ({
  tilePositions: new Set(),
  lineIndexes: new Set(),
  blackout: false,
});

/** Positions whose Increments have reached their Target. */
export const completedPositions = (tiles: readonly BoardTile[]): Set<number> => {
  const done = new Set<number>();
  for (const tile of tiles) {
    // Marked, not counted (§12.3). Checked first because a Family Goal has no Target to
    // fall back on, and reaching the count test would rule it out on that alone.
    if (tile.markedComplete === true) {
      done.add(tile.position);
      continue;
    }
    if (tile.target !== null && isTileComplete(tile.count, tile.target)) {
      done.add(tile.position);
    }
  }
  return done;
};

/**
 * Milestones earned but not yet recorded, in emission order: the Tiles that closed,
 * then the Lines they closed in constant order, then Blackout.
 *
 * The **first** Line a Member ever closes is their Bingo; every later one is the
 * quieter `line_completed` (PRD §13.2). When several Lines close at the same moment,
 * exactly one of them is the Bingo.
 */
export const milestonesToEmit = (
  tiles: readonly BoardTile[],
  recorded: RecordedMilestones,
): PendingMilestone[] => {
  const done = completedPositions(tiles);
  const emitted: PendingMilestone[] = [];

  for (const position of [...done].sort((a, b) => a - b)) {
    if (!recorded.tilePositions.has(position)) {
      emitted.push({ type: 'tile_completed', position });
    }
  }

  // Play continues after Bingo (PRD §13.4), so every Line still earns a Milestone.
  let bingoAlreadyEarned = recorded.lineIndexes.size > 0;
  for (const lineIndex of completedLines(done)) {
    if (recorded.lineIndexes.has(lineIndex)) continue;
    emitted.push({
      type: bingoAlreadyEarned ? 'line_completed' : 'bingo',
      lineIndex,
    });
    bingoAlreadyEarned = true;
  }

  if (!recorded.blackout && isBlackout(done)) {
    emitted.push({ type: 'blackout' });
  }

  return emitted;
};
