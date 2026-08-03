/**
 * Which Year a Family can open next, and how the Setup Window reads (PRD §5).
 *
 * Pure, and shared: §5.2's rule is that the window ends at 1 January in the Family's
 * timezone with a seven-day floor, and open_year() enforces exactly that server-side. The
 * client needs the same answer to say which Year the button opens and how long is left.
 */

import { MINIMUM_SETUP_WINDOW_DAYS, setupDeadline, startOfYearInZone } from './setup-window';

/** The calendar year it is where the Family lives (§8.3 T3), not where the server is. */
export const currentYearIn = (now: Date, timezone: string): number =>
  Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: timezone }).format(now));

/**
 * The Year a Family would open right now, or null if they already have every Year they
 * could open.
 *
 * The current year first, and that is the whole correction. open_year() only refuses a
 * year that has already ENDED, and setupDeadline()'s seven-day floor means the current
 * year always has a usable window — so a Family formed in March can and should open the
 * Year that is happening. Offering only next year left them with no Board until January,
 * which is nine months of an app that does nothing, and contradicts §4.5's "joining
 * mid-Year is normal".
 *
 * Takes the Years that already exist because §5.1 allows one per calendar year, and
 * "which Year is openable" cannot be answered without knowing which are taken.
 */
export const openableYear = (
  now: Date,
  timezone: string,
  existing: readonly number[] = [],
): number | null => {
  const thisYear = currentYearIn(now, timezone);
  const taken = new Set(existing);
  if (!taken.has(thisYear)) return thisYear;
  if (!taken.has(thisYear + 1)) return thisYear + 1;
  return null;
};

/**
 * Which Year a Family is actually living in right now.
 *
 * This exists because "the newest Year" and "the Year it is" are different questions, and
 * the screens were answering the first one. A Family with 2026 and 2027 both in `setup`
 * showed **2027** — the newest row — while the calendar said 2026. Nothing in that
 * selection ever asked what year it was; it just took the first row in a descending sort.
 *
 * So the calendar decides, and it decides in the Family's timezone (§8.3 T1) — on 31
 * December a Family in Auckland is already in next year while one in Los Angeles is not,
 * and each should see their own answer.
 *
 * Three tiers, in order, because a Family can be between Years:
 *
 *   1. The Year whose `calendar_year` **is** this one. Almost always the answer.
 *   2. Otherwise the most recent Year that has passed — a Family looking back in
 *      February at a 2026 that nobody has replaced yet should see 2026, not nothing.
 *   3. Otherwise the nearest Year still ahead — a Family who opened next year early has
 *      one Year and it is in the future; showing it beats showing a blank card.
 *
 * Status is deliberately not consulted. `setup`, `active` and `frozen` say where a Year
 * is in its own life, not whether it is the one happening — and reading them as relevance
 * is exactly the mistake this replaces.
 */
export const relevantYear = <T extends { calendar_year: number }>(
  now: Date,
  timezone: string,
  years: readonly T[],
): T | undefined => {
  const thisYear = currentYearIn(now, timezone);

  const exact = years.find((y) => y.calendar_year === thisYear);
  if (exact !== undefined) return exact;

  // Most recent past: the largest year below this one.
  const past = years.filter((y) => y.calendar_year < thisYear);
  if (past.length > 0) {
    return past.reduce((a, b) => (b.calendar_year > a.calendar_year ? b : a));
  }

  // Nearest future: the smallest year above this one.
  const future = years.filter((y) => y.calendar_year > thisYear);
  if (future.length > 0) {
    return future.reduce((a, b) => (b.calendar_year < a.calendar_year ? b : a));
  }

  return undefined;
};

/**
 * Whether a Setup Window is already open somewhere in this Family.
 *
 * Opening a second one is legal — §5.1 only forbids two Years with the same
 * `calendar_year` — and it is how a Family ends up authoring two Boards at once with
 * nothing on screen to say which is which. That is how a Family got a 2027 Board in
 * August: 2026 was open, so the button offered the next free year, and it was taken.
 *
 * Once the first Year seals this goes false again, which is the December case working
 * exactly as intended: 2026 is `active`, and 2027 can be opened for authoring.
 */
export const hasOpenSetupWindow = (years: readonly { status: string }[]): boolean =>
  years.some((y) => y.status === 'setup');

/**
 * Whole days between now and the Setup Window's end, counted as calendar days in the
 * Family's own timezone.
 *
 * Not `(deadline - now) / 86400000`. A day is not always 86,400,000 ms — a DST transition
 * inside the window silently eats one — and dividing wall-clock instants answers "how many
 * 24-hour blocks", which is not what "seals in 6 days" means to somebody looking at a
 * calendar. At 2pm on the 25th with a deadline of the 1st, the honest answer is seven
 * sleeps, and the arithmetic version said six.
 */
export const daysUntilSeal = (now: Date, deadline: Date, timezone = 'UTC'): number => {
  const dayIn = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone,
    }).format(d);
  // Midday UTC on each local date, so the subtraction cannot land on a DST boundary.
  const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);
  return Math.max(0, Math.round((noon(dayIn(deadline)) - noon(dayIn(now))) / 86_400_000));
};

/**
 * How the window reads to a Member, in the app's own voice.
 *
 * §4.5: "Any deadline copy is factual and never conditional" — "2028 opens in six days",
 * not "hurry". Nothing here counts down in a way that could scold (§0.3).
 */
export const sealCopy = (now: Date, deadline: Date, timezone = 'UTC'): string => {
  // Past the deadline is not "today" — the sweep has sealed it and the Year is under way.
  if (now.getTime() >= deadline.getTime()) return 'the board has sealed';
  const days = daysUntilSeal(now, deadline, timezone);
  if (days === 0) return 'the board seals today';
  if (days === 1) return 'the board seals tomorrow';
  return `the board seals in ${days} days`;
};

export { MINIMUM_SETUP_WINDOW_DAYS, setupDeadline, startOfYearInZone };
