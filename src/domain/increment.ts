/**
 * Logging an Increment — the words around one tap (PRD §11, FRONTEND_DESIGN §3, §4.1).
 *
 * Pure, no imports. The button's wording is shared by two screens that must agree: the
 * tile sheet's primary action, and the compose screen's preview beside the target stepper
 * ("once · the button will say 'Did it'"). Two copies of this would let a Member be
 * promised one verb while authoring and shown another all year.
 */

/** How many Increments the tile sheet lists under "Recent" (§3). */
export const RECENT_INCREMENTS = 3;

/**
 * The verb on the log button.
 *
 * §3 asks for a verb "phrased from the goal's unit", and gives *"Walked one"*, *"Read
 * one"* and *"Did it"* when the unit is null. Only the third is derivable: `unit_canonical`
 * is a singular **noun** by §7.10 — `"book"` for a Member who typed `Books` — and no rule
 * turns the noun "book" into the verb "read".
 *
 * So the irregular cases are a table, and everything else falls back to a phrasing that is
 * always true rather than sometimes wrong. A Member who logs "pomodoros" gets *"Log one
 * pomodoro"*, which is plain but never reads as a mistake — and the fallback is what most
 * Goals will use, because `unit_canonical` is `NULL` on any Goal that skipped Sharpening
 * (§6.1a) and those still log like any other.
 *
 * The table is deliberately short. It covers the units the examples name and their nearest
 * neighbours; it is not a dictionary, and growing it into one is not the fix if the copy
 * disappoints — the fix is for §3 to say what the rule is.
 */
const VERBS: Readonly<Record<string, string>> = {
  walk: 'Walked',
  step: 'Walked',
  mile: 'Walked',
  km: 'Walked',
  run: 'Ran',
  swim: 'Swam',
  ride: 'Rode',
  book: 'Read',
  page: 'Read',
  chapter: 'Read',
  session: 'Did',
  workout: 'Did',
  practice: 'Practised',
  lesson: 'Practised',
  visit: 'Visited',
  call: 'Called',
  meal: 'Cooked',
  dish: 'Cooked',
};

/**
 * `unit` is the Member's own wording and may be plural, capitalised, or padded (§6.1);
 * `unitCanonical` is the singular lowercase form, and is `NULL` unless Sharpening ran.
 */
export const incrementVerb = (
  unit: string | null,
  unitCanonical: string | null,
): string => {
  const canonical = (unitCanonical ?? '').trim().toLowerCase();
  const verb = canonical === '' ? undefined : VERBS[canonical];
  if (verb !== undefined) return `${verb} one`;

  // Only `unit_canonical` is safe to put after "one". It is singular by §7.10; the
  // Member's own wording is whatever they typed, and is usually plural — a Goal with
  // unit "runs" produced **"Log one runs"**, which is the sort of thing that reads as a
  // bug in the app rather than a gap in the copy.
  //
  // So a Goal that skipped Sharpening (§6.1a, `unit_canonical` NULL — which will be most
  // of them) gets the unit-less phrasing. "Log one" is plain, but it is never wrong, and
  // the ring beside it already says one *what*.
  if (canonical !== '') return `Log one ${canonical}`;
  // §3: "Did it" is the phrasing when there is no unit — a Goal counted in bare numbers.
  return (unit ?? '').trim() === '' ? 'Did it' : 'Log one';
};

/**
 * "3 of 144", and the one place §3 allows the exact number to appear large.
 *
 * Not clamped, unlike `progressOf`. The ring stops at full but the count is a fact, and a
 * Member who logged 160 of 150 should read 160 — overshoot is only hidden on the *board*,
 * where it would reintroduce the ladder §13.5 forbids.
 */
export const countSummary = (count: number, target: number): string =>
  `${count} of ${target}`;
