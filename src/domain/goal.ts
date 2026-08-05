/**
 * What makes a Goal a Goal, and how one reads back (PRD §6, FRONTEND_DESIGN §4.1).
 *
 * Pure and shared, for the reason everything in this directory is: `write_goal()` enforces
 * the same bounds server-side and the two have to agree. A rule that lives next to its
 * caller ends up with two versions.
 *
 * The shape rule worth restating, because it looks like something is missing: **`target =
 * 1` IS the one-shot Goal.** There is no type, no enum, no second code path — "Run a
 * marathon" is target 1 and "Read 12 books" is target 12, and everything downstream treats
 * them identically (§6.2, ADR-0002). Nothing here may branch on which one it is except to
 * choose a word.
 *
 * The increment verb and `stepperHint` are **not** here, and used to be: they live in
 * `increment.ts`, which owns what the logging button says. See the note above
 * `incrementVerb` there for what the copy in this file got wrong.
 */

import { BOARD_SIZE, CENTER_POSITION } from './lines';

/** §6.1. The database checks the same numbers in `write_goal()`. */
export const GOAL_TEXT = { min: 1, max: 200 } as const;
export const UNIT_MAX = 30;
export const TARGET_MIN = 1;

/**
 * Position 12 is the Centre and is not authored like the others (§6.5), which leaves 24.
 *
 * **Re-exported, not declared.** `lines.ts` owns the twelve, because 12 is geometry rather
 * than an authoring rule: it is the square `linesThrough(12)` puts on four Lines, and that
 * is where it is tested. A `= 12` was written here too and the consumers split between the
 * two copies at random — `components/Board.tsx` read lines.ts, `lib/queries/boards.ts` read
 * this file, and neither reader could tell there was a second one. `theme/tokens.ts` makes
 * exactly this argument about the Board's five: "a second copy is a copy that can disagree
 * with line detection."
 *
 * Authoring still says `CENTER_POSITION` and finds it here, which is why the re-export
 * exists rather than a note telling everyone to import from somewhere else.
 */
export { CENTER_POSITION };

/**
 * The 24 squares a Member writes: every position but the Centre (§6.5).
 *
 * Derived rather than typed. `24` and `12` are the same fact about a 5×5 stated twice, and
 * a Board that ever stopped being 25 squares would have left this reading 24 with nothing
 * to catch it.
 */
export const AUTHORABLE_TILES = BOARD_SIZE - 1;

/**
 * What is wrong with this Goal's text, in words a Member can act on, or `null`.
 *
 * Says what to do rather than what went wrong (§0.3): "Write the goal first", not "Text is
 * required."
 */
export const goalTextProblem = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed.length < GOAL_TEXT.min) return 'Write the goal first.';
  if (trimmed.length > GOAL_TEXT.max) return `That is longer than ${GOAL_TEXT.max} characters.`;
  return null;
};

/**
 * The unit is the Member's own wording and is optional (§6.1) — "books", "runs", "cups of
 * tea". Nothing infers it and nothing corrects it; `unit_canonical` is Sharpening's job
 * (§7.10) and is never typed here.
 */
export const unitProblem = (unit: string): string | null => {
  if (unit.trim().length > UNIT_MAX) return `That is longer than ${UNIT_MAX} characters.`;
  return null;
};

/**
 * A target is a whole number of at least one.
 *
 * A stepper cannot produce a fraction, so this exists for the typed field and for the
 * boundary's own sake — `write_goal()` raises 22023 on the same condition, and a Member
 * should never be the one to discover that.
 */
export const targetProblem = (target: number): string | null => {
  if (!Number.isInteger(target)) return 'A target is a whole number.';
  if (target < TARGET_MIN) return 'A target is at least one.';
  return null;
};

/**
 * The target as a phrase — "once", "12 books", "12 times".
 *
 * The unit is never pluralised. A Member who typed "books" gets "12 books" and one who
 * typed "book" gets "12 book", and that is deliberate: guessing an English plural means
 * guessing wrong in front of someone who chose their own word, and §7.10's
 * `unit_canonical` already exists for the one place grouping actually matters.
 */
export const targetSummary = (target: number, unit: string | null = null): string => {
  const word = unit === null ? '' : unit.trim();
  if (target === 1 && word === '') return 'once';
  if (word === '') return `${target} times`;
  return `${target} ${word}`;
};

/**
 * How far through authoring a Member is — "17 of 24".
 *
 * Never a percentage and never a bar. §4.1 puts the count in `label` beside the deadline,
 * and §0.3 rules out anything that could read as a pace: a Member with three goals written
 * on 30 December is not behind, they are writing.
 */
export const draftProgress = (written: number): string => `${written} of ${AUTHORABLE_TILES}`;

/**
 * The status line under "Write another" (§4.1) — how many Tiles are still empty.
 *
 * Stated as a fact about the Board, never as an instruction. An unfinished Board seals
 * with empty Tiles and that is a legitimate outcome (§10.2), so the copy must not imply
 * the Member has failed to do something.
 */
export const remainingCopy = (written: number): string => {
  const left = Math.max(0, AUTHORABLE_TILES - written);
  if (left === 0) return 'All 24 written.';
  if (left === 1) return '1 still empty.';
  return `${left} still empty.`;
};
