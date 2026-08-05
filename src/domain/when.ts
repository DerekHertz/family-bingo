/**
 * Saying when something happened, in the app's voice.
 *
 * One module rather than a `toLocaleDateString` in every screen that shows a date. The
 * Feed, the tile sheet's Recent rows and the Milestone card all state the same kind of
 * fact, and three spellings of it is three chances for one of them to read differently
 * from the others.
 *
 * **These are not deadline arithmetic.** `setup-window.ts` resolves instants in the
 * Family's timezone because a Setup Window closing an hour early is a Member losing a day
 * (§8.3 T1). This file only labels an instant that has already happened, where the
 * handset's own zone is the honest answer: a Member in Berlin reading a Feed written in
 * Denver should see the time they would have felt it.
 *
 * Pure, and imports nothing (PRD §13.6).
 */

/** "14 Mar" — the Recent rows and the Feed's timestamps. */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * "14 March" — the Milestone card, where there is room and only one date on the screen.
 *
 * No year. Every screen that uses this is already inside one Year and says which
 * (FRONTEND_DESIGN §4's meta line), so repeating it is noise.
 */
export const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
