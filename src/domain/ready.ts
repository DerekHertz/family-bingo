/**
 * Whether a Board is finished, and whether a Family is (PRD §22).
 *
 * The Setup Window ends on a fixed date whether or not everyone has finished — that rule
 * exists so one person's silence cannot hold four other people at the starting line, and
 * §22 does not weaken it. It adds the opposite case: a Family who are all done are not
 * waiting on a decision, they are waiting on a calendar, and `mark_board_ready()` is how
 * they stop.
 *
 * Two questions live here because both are asked in three places each — the Board screen
 * deciding whether to offer the control, the Family screen saying who is still writing,
 * and the confirm sheet saying what the tap gives up.
 *
 * `board_is_complete()` and `year_is_ready()` are the server's copies (migration 41), and
 * they are the ones that decide. These exist so the app never offers a control that the
 * server would refuse (§0.3). If you change one, change both.
 *
 * Pure (PRD §13.6).
 */

/** The Center Tile. Never authored during the Setup Window (§6.5). */
export const CENTRE_POSITION = 12;

/** How many squares a Member writes: 25 minus the Centre (FRONTEND_DESIGN §4.2). */
export const AUTHORABLE_SQUARES = 24;

/** A Tile, narrowed to the one thing completeness asks of it. */
export interface AuthorableTile {
  readonly position: number;
  readonly goal: unknown | null;
}

/**
 * The squares still to write, in position order.
 *
 * Position 12 is never among them. In shared mode the Family Goal lands there at
 * resolution (§9.4) and in personal mode the Member writes it in the seven days *after*
 * the seal (§9.5) — so a Board whose only empty square is the Centre is as finished as its
 * owner can make it, and treating the Centre as outstanding would put Ready permanently
 * out of reach for every Family that votes personal.
 */
export const emptySquares = (tiles: readonly AuthorableTile[]): number[] =>
  tiles
    .filter((tile) => tile.position !== CENTRE_POSITION && tile.goal === null)
    .map((tile) => tile.position)
    .sort((a, b) => a - b);

/**
 * Whether every authorable square holds a Goal.
 *
 * The count check is the load-bearing half. `every()` over an empty array is `true`, so a
 * query that failed, paged short, or has not resolved yet would otherwise read as a
 * finished Board and offer a control that seals four other people's Boards. A Board is
 * complete when all 24 squares are *present* and all 24 are filled — fail shut, the same
 * rule the Swap budget learned the hard way (`swapsUsed: budget.data ?? 0`).
 */
export const boardIsComplete = (tiles: readonly AuthorableTile[]): boolean => {
  const authorable = tiles.filter((tile) => tile.position !== CENTRE_POSITION);
  return authorable.length === AUTHORABLE_SQUARES && authorable.every((t) => t.goal !== null);
};

/** One Board in the Family, as the readiness question sees it. */
export interface ReadinessBoard {
  readonly displayName: string;
  readonly readyAt: string | null;
  readonly sealedAt: string | null;
  /**
   * Whether the caller controls this Board — their own, or a Managed Member's (§4.2).
   *
   * Here so that the Family screen cannot name the reader to themselves. It is not a
   * privacy field; every one of these rows is readable by everyone in the Family.
   */
  readonly isSelf: boolean;
}

export interface Readiness {
  /** Boards that could still be waited on — sealed ones cannot be. */
  readonly total: number;
  readonly ready: number;
  /** Who the Family is still waiting for, in the order the Boards arrived. */
  readonly waitingOn: readonly string[];
  /** True when the last declaration would seal the Year. */
  readonly unanimous: boolean;
}

/**
 * Where a Family has got to.
 *
 * A sealed Board counts as neither ready nor waited-on. That is not a special case: it is
 * the same rule `year_is_ready()` applies, and it is what lets a late joiner's Board sit
 * inside an active Year without the Family being told it is waiting on someone who has
 * already been playing for a month.
 *
 * **`waitingOn` never names the reader.** The counts include them — `2 of 4` has to be
 * true — but a Family screen that reads *"waiting on Derek"* to Derek is §0.3's scold
 * aimed at the one person who already knows, and it is the person least in need of being
 * told. `unanimous` is unaffected: it asks about every Board, the caller's included, or it
 * would go true while the reader still had squares to write.
 *
 * `unanimous` is false for an empty list. A Family with no Boards has not finished
 * anything, and the vacuous reading of "no Board is unready" is exactly the bug that would
 * seal a Year the instant it opened.
 */
export const readiness = (boards: readonly ReadinessBoard[]): Readiness => {
  const open = boards.filter((b) => b.sealedAt === null);
  const unready = open.filter((b) => b.readyAt === null);
  return {
    total: open.length,
    ready: open.length - unready.length,
    waitingOn: unready.filter((b) => !b.isSelf).map((b) => b.displayName),
    unanimous: open.length > 0 && unready.length === 0,
  };
};

/**
 * How that reads on the Family screen.
 *
 * Factual, never conditional (§4.5), and never a nudge: naming who is still writing is a
 * fact about the Family, and "waiting on Bob" said in a tone is how an app starts
 * scolding on someone else's behalf (§0.3). One name is named because it is useful; a
 * list of four is a scoreboard, so past one it counts instead.
 */
export const readinessCopy = (state: Readiness): string => {
  if (state.total === 0) return 'no boards yet';
  if (state.unanimous) return 'everyone is done';
  // Zero names with the Family not unanimous means the reader is the only one left, since
  // `waitingOn` drops them. The count is the honest thing to say, and it says it without
  // pointing.
  if (state.waitingOn.length === 1) return `waiting on ${state.waitingOn[0]}`;
  return `${state.ready} of ${state.total} boards are done`;
};
