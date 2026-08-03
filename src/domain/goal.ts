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
 */

/** §6.1. The database checks the same numbers in `write_goal()`. */
export const GOAL_TEXT = { min: 1, max: 200 } as const;
export const UNIT_MAX = 30;
export const TARGET_MIN = 1;

/**
 * Position 12 is the Centre and is not authored like the others (§6.5), which leaves 24.
 * Row-major, 0-indexed, and load-bearing for line detection — see §5.4 before touching it.
 */
export const CENTER_POSITION = 12;
export const AUTHORABLE_TILES = 24;

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
 * What the logging button will say once the Year is under way (§4.1, §11.1).
 *
 * A one-shot Goal is done in a single tap and the word is the whole event, so "Did it"
 * rather than a count of one. Everything else counts, and counts up.
 */
export const incrementVerb = (target: number): string => (target === 1 ? 'Did it' : '+1');

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
 * The line beside the stepper: what this Goal is, and what logging it will feel like.
 *
 * §4.1 writes it as `"once · the button will say 'Did it'"`. Showing the verb while the
 * target is still being chosen is the point — it is the only moment the difference between
 * a one-shot and a cumulative Goal is visible before a Year of tapping settles it.
 */
export const stepperHint = (target: number, unit: string | null = null): string =>
  `${targetSummary(target, unit)} · the button will say “${incrementVerb(target)}”`;

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
