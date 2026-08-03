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
