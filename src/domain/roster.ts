/**
 * What tapping a Member on the Family screen leads to (PRD §23).
 *
 * "A named group of people who can see each other's boards for a given year" is the first
 * line of CONTEXT.md's **Family**, and `boards_read` has been Family-wide since the RLS
 * baseline — *"it has to be, because seeing everyone's Board is the whole game."* The
 * Board route has always rendered a sibling's Board correctly, with every write affordance
 * removed. The only thing missing was a way to get there that was not a push notification.
 *
 * So this module is not about permission. It is about what a row can honestly offer, which
 * is a different answer for each of five states a Member can be in — and about making sure
 * the four that are not "go" still say something true rather than dead-tapping.
 *
 * **Nothing here reports progress**, and that is a rule rather than an omission (§23.4).
 * FRONTEND_DESIGN §7's do-not #2 forbids ranking Members visually and names this exact
 * component — *"no sorting the member strip by progress"*. Sorting is not the only way to
 * build a ladder: five faces each wearing a completion ring is an ordered comparison
 * whether or not the order encodes it, because the reader does the sorting. Wrapped is
 * where cross-Member numbers are legitimate, retrospectively and on unrelated axes
 * (ADR-0006), and the argument there turns on it *not* being live.
 *
 * Pure (PRD §13.6).
 */

/** A Member on the roster, narrowed to what deciding the tap needs. */
export interface RosterMember {
  readonly id: string;
  readonly status: string;
}

/** Their Board in the Year on screen, or `undefined` when they have none. */
export interface VisitableBoard {
  readonly memberId: string;
  readonly boardId: string;
  readonly sealedAt: string | null;
  readonly readyAt: string | null;
}

/**
 * The five states, and only `open` carries somewhere to go.
 *
 * `writing` and `done` are the Setup Window, where §23.2 keeps Goals private: the Family
 * learns *that* somebody is finished, never *what* they wrote. That line was drawn by §22
 * — the readiness copy on the Family screen — and this reuses it rather than inventing a
 * second, more revealing answer to the same question.
 */
export type BoardVisit =
  | { readonly kind: 'open'; readonly boardId: string }
  | { readonly kind: 'writing' }
  | { readonly kind: 'done' }
  | { readonly kind: 'unopened' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown' };

/**
 * Whether this Member's Board can be opened, and if not, which "not" it is.
 *
 * A Board that has sealed is the only one that opens. Not because RLS would refuse the
 * others — it would not — but because a draft is not a board yet: §4.1 says "the board
 * isn't drawn until it seals", so there is literally nothing to look at, and §7.5's
 * insistence that nobody may judge a Goal into shape applies hardest at the one moment
 * its author can still cave and rewrite it.
 */
export const boardVisit = (
  member: RosterMember,
  board: VisitableBoard | undefined,
  /**
   * Whether the Year and its Boards have actually been read yet. **Absence of a Board and
   * absence of an answer are not the same fact**, and defaulting the second to the first
   * is a sentence about a person that happens to be false.
   *
   * Three states reach it: a Family that has not opened a Year at all, a Family screen
   * whose Years have not resolved on this render, and a Boards read that failed outright.
   * In every one of them the honest row says nothing rather than "no board for 2026" — the
   * same fail-shut rule as `swapsUsed: budget.data ?? SWAP_BUDGET`, applied to copy instead
   * of to a budget.
   */
  known = true,
): BoardVisit => {
  // A pending Member reads nothing and has no Board by construction (§3.2). They appear on
  // the roster because they are waiting on somebody, and that is all their row is about —
  // which is knowable without a Year, so it is answered before `known` is consulted.
  if (member.status === 'pending') return { kind: 'pending' };
  if (!known) return { kind: 'unknown' };
  // Not every Member has a Board in every Year. Somebody approved after a Year opened has
  // none for it and never will — a real Account in this Family is in exactly that state
  // for 2026 — and they are still a voter, still on the roster, still a person.
  if (board === undefined) return { kind: 'unopened' };
  if (board.sealedAt !== null) return { kind: 'open', boardId: board.boardId };
  return board.readyAt !== null ? { kind: 'done' } : { kind: 'writing' };
};

/**
 * What the row says under the name, or `null` when the state speaks for itself.
 *
 * `open` returns null on purpose: a sealed Board's row is a tap target and says so by
 * being one. "Board sealed" underneath would be a label on the normal case, which is how
 * a screen fills up with words that stop being read.
 *
 * The Year is named in the one sentence that would otherwise sound like a verdict on the
 * Member. "No board" reads as something they failed to do; "no board for 2026" reads as
 * what it is — the Year they arrived in — which is the same argument §21.4's "joined July"
 * marker makes about a sparse Board in September.
 */
export const boardVisitCopy = (visit: BoardVisit, calendarYear: number): string | null => {
  switch (visit.kind) {
    case 'open':
      return null;
    case 'writing':
      return 'still writing';
    case 'done':
      return 'board done';
    case 'unopened':
      return `no board for ${calendarYear}`;
    case 'pending':
      return 'waiting to be let in';
    // Nothing is known, so nothing is said. A row that goes quiet for a moment is a row
    // somebody reads once the answer arrives; a row that says the wrong thing confidently
    // is one they believe.
    case 'unknown':
      return null;
  }
};

/**
 * The faces on the board header's strip (FRONTEND_DESIGN §4.5), in the order they arrive.
 *
 * **Built from the Members, not from the Boards**, and that distinction is the whole of
 * §23.5. A Member approved after a Year opened has no `boards` row for it at all — not an
 * unsealed one, none — so a strip mapped over Boards cannot render them however carefully
 * it handles the states it can see. It does not dim them or mark them unavailable; it
 * silently produces a Family one person short, which is §7's do-not #2 ("+12" counts
 * people) arrived at from the other side. Caught in the simulator, by noticing somebody
 * was missing.
 *
 * Everyone active appears. Whoever has no sealed Board is a face with no destination.
 * Ordering is the caller's — the roster hands it over in join order, the only ordering
 * do-not #2 permits.
 */
export interface StripFace {
  readonly memberId: string;
  readonly displayName: string;
  readonly isManaged: boolean;
  /** Where tapping goes, or null when this face is not a door. */
  readonly boardId: string | null;
  /** The Board being looked at right now. Marked, never moved to the front. */
  readonly isCurrent: boolean;
}

/** A Member as the strip needs them — the roster's shape, not the Boards'. */
export interface StripMember extends RosterMember {
  readonly displayName: string;
  readonly isManaged: boolean;
}

export const stripFaces = (
  members: readonly StripMember[],
  boards: readonly VisitableBoard[],
  currentBoardId: string | undefined,
): StripFace[] => {
  const boardOf = new Map(boards.map((board) => [board.memberId, board]));
  return members
    // A pending Member is not in the Family yet and reads nothing (§3.2, §23.6). The
    // roster row is where their arrival is somebody's business; a Board header is not.
    .filter((member) => member.status === 'active')
    .map((member) => {
      const board = boardOf.get(member.id);
      const visit = boardVisit(member, board);
      return {
        memberId: member.id,
        displayName: member.displayName,
        isManaged: member.isManaged,
        boardId: visit.kind === 'open' ? visit.boardId : null,
        isCurrent: board !== undefined && board.boardId === currentBoardId,
      };
    });
};
