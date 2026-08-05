/**
 * Swaps — a Member's permitted changes to a Sealed Board.
 *
 * A Bingo notification is a social claim. Without a budget, anyone could lower a Target
 * from 144 to 90 in November and manufacture one; scarcity plus visibility closes that
 * without making the Board a prison (PRD §18.5). Raising a Target is deliberately free,
 * because making a Goal harder needs no policing (§18.3).
 *
 * Pure. The budget is also enforced in the database (§18.1) — this module is what the
 * UI and the RPC agree on, not the enforcement of last resort.
 */

/** Three per Member per Year (PRD §18.1). */
export const SWAP_BUDGET = 3;

export interface GoalShape {
  readonly text: string;
  readonly target: number;
}

/** What a proposed edit costs. */
export type RewriteCost = 'none' | 'free' | 'swap';

export interface GoalRewriteContext {
  /** Before Sealing everything is free editing (PRD §6.4). */
  readonly sealed: boolean;
  /** A frozen Year is permanently read-only (PRD §20.1). */
  readonly frozen: boolean;
  readonly swapsUsed: number;
  /** A shared Center Tile is one row on every Board and is never swappable. */
  readonly isSharedCenter: boolean;
  readonly isComplete: boolean;
}

export type SwapRefusal =
  | 'year_frozen'
  | 'budget_exhausted'
  | 'shared_center_tile'
  | 'tile_complete';

export type GoalRewriteDecision =
  | { readonly allowed: true; readonly cost: RewriteCost; readonly swapsRemainingAfter: number }
  | { readonly allowed: false; readonly reason: SwapRefusal };

export const swapsRemaining = (swapsUsed: number): number =>
  Math.max(0, SWAP_BUDGET - swapsUsed);

/**
 * Why a square cannot be swapped, said to the Member.
 *
 * Every one of these is a state the client can see before it asks, and `swap_tile()`
 * refuses all four with `PT403` — one SQLSTATE covering four different reasons. So the
 * discrimination has to happen here, on facts already in hand, rather than by matching the
 * server's message text (which the handoff warns about, and which would break the day
 * somebody rewords a `raise`).
 *
 * Nothing here scolds and nothing suggests a workaround that does not exist (§0.3). "No
 * swaps left" is a fact about a budget the Member spent; §18.5 is explicit that the
 * scarcity is the feature.
 */
export const swapRefusalCopy = (reason: SwapRefusal): string => {
  switch (reason) {
    case 'year_frozen':
      // §20.1 — frozen Years are permanently read-only. There is no retry and no appeal.
      return 'This year is finished. Its boards are family history now.';
    case 'budget_exhausted':
      return 'No swaps left this year. They come back when the next year opens.';
    case 'shared_center_tile':
      // §12.3 — one row referenced by every Board. Changing it would change everyone's.
      return 'The middle square belongs to the whole family, so nobody swaps it alone.';
    case 'tile_complete':
      // §4.4: "Not swappable: the Centre, and any Tile already `complete`."
      return 'This one is already done. Nothing left to change.';
  }
};

/**
 * What the confirm sheet says will happen to the Increments already logged.
 *
 * **§18.6 is the authority here, not FRONTEND_DESIGN §4.4, and they disagree.**
 *
 * §4.4 says *"The Tile resets to `dormant` because `COUNT(increments)` on the new Goal is
 * zero"*. That is a stale model of the schema and it is not what ships. §18.6 says
 * *"Swapping does not delete existing Increments; **progress carries over against the new
 * Target**"*, `increments` references `tile_id` and never `goal_id`, and `swap_tile()`
 * updates the Goal **in place** — there is no new Goal row and nothing is re-pointed. The
 * migration says so itself: "Progress hangs off the Tile, not the Goal, so it carries over
 * against the new Target by construction."
 *
 * The proof is three lines further down in that same function: if progress already meets
 * the new Target it calls `record_tile_completion()` and `record_line_milestones()`. That
 * branch is only reachable *because* progress carries over.
 *
 * This copy said the opposite, which was the worst possible place to be wrong. A Member at
 * 100 of 144 who lowers the Target to 90 was told the square would restart from zero — and
 * what actually happens is that the Tile completes on save, a Line may close, and a Bingo
 * is written and pushed to every phone in the Family. That is exactly the manufactured
 * Bingo §18.5 exists to make visible, and the app was promising it could not happen.
 *
 * `completesNow` is that case said out loud, because it is irreversible and family-visible
 * and a Member should not meet it as a surprise (§0.3).
 */
export const swapConsequenceCopy = (loggedSoFar: number, completesNow = false): string => {
  if (loggedSoFar === 0) {
    return 'Nothing is deleted. This square starts from zero, because nothing has been logged on it yet.';
  }
  const kept =
    loggedSoFar === 1
      ? 'Nothing is deleted. The one you have logged stays on this square and counts towards the new goal.'
      : `Nothing is deleted. The ${loggedSoFar} you have logged stay on this square and count towards the new goal.`;
  return completesNow
    ? `${kept} That is already enough — the square finishes as soon as you save, and your family will see it.`
    : kept;
};

/**
 * What an edit costs on a Sealed Board.
 *
 * `before` is `null` for an unfilled Tile — an unfinished Board seals with empty Tiles
 * (§10.2) and filling one later costs a Swap (§18.5).
 */
export const costOfRewrite = (
  before: GoalShape | null,
  after: GoalShape,
): RewriteCost => {
  if (before === null) return 'swap';
  const textRewritten = before.text.trim() !== after.text.trim();
  if (textRewritten) return 'swap';
  if (after.target < before.target) return 'swap';
  if (after.target > before.target) return 'free';
  return 'none';
};

/**
 * Whether a Member may make this edit, and what it costs them.
 *
 * Order matters: a frozen Year refuses everything, and a Tile that is already complete
 * or shared refuses regardless of budget.
 */
export const evaluateGoalRewrite = (
  context: GoalRewriteContext,
  before: GoalShape | null,
  after: GoalShape,
): GoalRewriteDecision => {
  if (context.frozen) return { allowed: false, reason: 'year_frozen' };

  const remaining = swapsRemaining(context.swapsUsed);

  // A draft Board is not a commitment yet, so nothing on it costs anything.
  if (!context.sealed) {
    return { allowed: true, cost: 'free', swapsRemainingAfter: remaining };
  }

  if (context.isSharedCenter) return { allowed: false, reason: 'shared_center_tile' };
  if (context.isComplete) return { allowed: false, reason: 'tile_complete' };

  const cost = costOfRewrite(before, after);
  if (cost === 'swap' && remaining === 0) {
    return { allowed: false, reason: 'budget_exhausted' };
  }

  return {
    allowed: true,
    cost,
    swapsRemainingAfter: cost === 'swap' ? remaining - 1 : remaining,
  };
};
