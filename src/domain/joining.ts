/**
 * Joining partway through a Year (PRD §21).
 *
 * A Member approved in July gets a Board with a seven-day personal Setup Window, inherits
 * the Centre the Family already decided, and plays to December 31 — and that is the whole
 * feature. §21.5 is emphatic about what is *not* here:
 *
 * > **No proration, no special-casing.** This works precisely because §13.5 removed
 * > ranking — there is no standing to be behind in.
 *
 * So everything in this file is a **statement of fact**, never an apology and never a
 * catch-up. "Joined in July" exists so the Feed makes sense (§21.4) — a Board with eleven
 * empty squares in September reads differently once you know when it started — and for no
 * other reason. Nothing here may compare a late joiner to anyone, suggest they are behind,
 * or offer to make it fair.
 *
 * Pure, and imports nothing (PRD §13.6).
 */

/**
 * The month a Member arrived, in the Family's own timezone.
 *
 * The Family's, not the device's: a Member approved at 11pm on 31 July in New York joined
 * in July, and a Guardian reading it from Berlin should be told the same month the rest of
 * the Family sees. This is the same rule §8.3 T1 applies to deadlines, for the same
 * reason — a Family's calendar is one calendar.
 */
export const joinedMonth = (joinedLateAt: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en', { month: 'long', timeZone }).format(new Date(joinedLateAt));

/**
 * §21.4's marker: *"Their Board shows a 'joined July' marker so the Feed makes sense."*
 *
 * Past tense and no number. "Joined in July" is a fact about a date; "joined 5 months
 * late" is a judgment, and there is nothing to be late for (§21.5).
 */
export const joinedMarker = (joinedLateAt: string, timeZone: string): string =>
  `Joined in ${joinedMonth(joinedLateAt, timeZone)}`;

/**
 * The one paragraph a late joiner's drafting table adds, and what it must and must not say.
 *
 * It says two things, because they are the two facts that would otherwise look like bugs:
 *
 *   - **Their deadline is not the Family's.** Everyone else's Board sealed on 1 January;
 *     theirs seals seven days from approval (§21.1). Without this the screen shows a date
 *     nobody else has and no reason for it.
 *   - **The Centre is already decided** (§21.2). The Centre Vote is not reopened — doing so
 *     would alter a Tile on every already-sealed Board — so the middle square arrives
 *     filled in and un-votable, which looks broken until it is explained.
 *
 * What it does not say: how much of the Year is left, how far ahead anyone else is, or
 * anything a Member could read as being behind (§0.3, §21.5).
 */
export const lateJoinerNote = (centreIsShared: boolean): string =>
  centreIsShared
    ? 'You joined partway through this year, so your board has its own seven days rather ' +
      'than the family’s. The middle square was decided before you arrived and is already ' +
      'filled in.'
    : 'You joined partway through this year, so your board has its own seven days rather ' +
      'than the family’s. Everything else works the same way it does for everyone.';
