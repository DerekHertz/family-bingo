/**
 * Logging an Increment — the words around one tap (PRD §11, FRONTEND_DESIGN §3, §4.1).
 *
 * The button's wording is shared by two screens that must agree: the tile sheet's primary
 * action, and the compose screen's preview beside the target stepper ("once · the button
 * will say 'Did it'"). **Both of them read `incrementVerb` below, and only that one.**
 *
 * That header used to be a warning about a duplicate this file did not know it had.
 * `goal.ts` carried a second `incrementVerb(target)` — `target === 1 ? 'Did it' : '+1'` —
 * reached through its own `stepperHint`, so the compose screen previewed one rule while
 * the tile sheet shipped another. They agreed only on a Goal with no unit at all: a Goal
 * with target 12 and unit "books" was promised **"+1"** while it was being written and
 * showed **"Read one"** for the rest of the Year. Two wordings would have been a copy
 * disappointment; two *rules* is the app contradicting itself, so the `goal.ts` copy is
 * gone and this module owns the verb.
 *
 * `targetSummary` is imported rather than restated for the same reason. Both modules are
 * pure and `goal.ts` imports nothing from here, so there is no cycle to worry about.
 */

import { targetSummary } from './goal';

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
 * The line beside the target stepper: what this Goal is, and what logging it will feel like.
 *
 * §4.1 writes it as `"once · the button will say 'Did it'"`. Showing the verb while the
 * target is still being chosen is the point — it is the only moment the difference between
 * a one-shot and a cumulative Goal is visible before a Year of tapping settles it.
 *
 * It takes the unit arguments the button itself takes, because it is a **preview of that
 * button** and anything less is a promise the sheet then breaks. It lived in `goal.ts`
 * beside a second verb rule that knew only the target, which is how "12 books" came to be
 * previewed as "+1".
 *
 * The preview is still approximate for a Goal about to be sharpened, and honestly so:
 * `unit_canonical` is Sharpening's (§7.10) and is NULL until it runs, so a Member typing
 * "books" before asking for a suggestion is shown *"Log one"* and will get *"Read one"*
 * once `unit_canonical` lands. That gap is unavoidable — the screen cannot know a word the
 * model has not returned yet — and it is one rule reading an incomplete Goal rather than
 * two rules disagreeing about a complete one.
 */
export const stepperHint = (
  target: number,
  unit: string | null,
  unitCanonical: string | null = null,
): string =>
  `${targetSummary(target, unit)} · the button will say “${incrementVerb(unit, unitCanonical)}”`;

/**
 * "3 of 144", and the one place §3 allows the exact number to appear large.
 *
 * Not clamped, unlike `progressOf`. The ring stops at full but the count is a fact, and a
 * Member who logged 160 of 150 should read 160 — overshoot is only hidden on the *board*,
 * where it would reintroduce the ladder §13.5 forbids.
 */
export const countSummary = (count: number, target: number): string =>
  `${count} of ${target}`;
