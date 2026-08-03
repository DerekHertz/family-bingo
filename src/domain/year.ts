/**
 * Which Year a Family can open next, and how the Setup Window reads (PRD §5).
 *
 * Pure, and shared: §5.2's rule is that the window ends at 1 January in the Family's
 * timezone with a seven-day floor, and open_year() enforces exactly that server-side. The
 * client needs the same answer to say which Year the button opens and how long is left.
 */

import { MINIMUM_SETUP_WINDOW_DAYS, setupDeadline, startOfYearInZone } from './setup-window';

/**
 * The Year a Family would open right now.
 *
 * The next calendar year, unless there is still a usable window before this one's — which
 * only happens in the last week of December, when opening "next year" and opening "this
 * year" mean the same thing to everybody except the calendar.
 */
export const openableYear = (now: Date, timezone: string): number => {
  const thisYear = Number(
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: timezone }).format(now),
  );
  return thisYear + 1;
};

/** Days between now and the Setup Window's end, rounded down and never negative. */
export const daysUntilSeal = (now: Date, deadline: Date): number =>
  Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 86_400_000));

/**
 * How the window reads to a Member, in the app's own voice.
 *
 * §4.5: "Any deadline copy is factual and never conditional" — "2028 opens in six days",
 * not "hurry". Nothing here counts down in a way that could scold (§0.3).
 */
export const sealCopy = (now: Date, deadline: Date): string => {
  const days = daysUntilSeal(now, deadline);
  if (days === 0) return 'the board seals today';
  if (days === 1) return 'the board seals tomorrow';
  return `the board seals in ${days} days`;
};

export { MINIMUM_SETUP_WINDOW_DAYS, setupDeadline, startOfYearInZone };
