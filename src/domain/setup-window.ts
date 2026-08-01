/**
 * When a Year opens, seals, and freezes.
 *
 * Every Family has an IANA timezone, and Setup Window deadlines, Freeze and Digests all
 * resolve in it (PRD §8.3 T1). Instants are `Date` — always an absolute point in time,
 * stored as `timestamptz` (T2). "Year" means the calendar year in the Family's timezone
 * (T3), which is why a Tokyo Family's 2027 freezes fourteen hours before a New York
 * Family's.
 *
 * Pure, apart from `Intl` for zone offsets.
 */

/** PRD §5.2, and the personal window a late joiner gets (§21.1). */
export const MINIMUM_SETUP_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * The offset of a timezone at a given instant, in milliseconds east of UTC.
 *
 * Derived by formatting the instant in the zone and reading the wall clock back, which
 * is the only offset source available without a timezone database.
 */
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const wallClock = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  // Sub-second precision is discarded by the formatter; add it back so the offset is exact.
  return wallClock - (instant.getTime() - (instant.getTime() % 1000));
};

/**
 * The instant at which a wall-clock time occurs in a timezone.
 *
 * Two passes: guess that the wall clock is UTC, correct by the offset there, then
 * correct again in case the first guess landed on the far side of a DST transition.
 */
const instantOf = (
  wallClock: { year: number; month: number; day: number },
  timeZone: string,
): Date => {
  const asIfUtc = Date.UTC(wallClock.year, wallClock.month - 1, wallClock.day);
  let ts = asIfUtc;
  for (let pass = 0; pass < 2; pass++) {
    ts = asIfUtc - zoneOffsetMs(new Date(ts), timeZone);
  }
  return new Date(ts);
};

/** Midnight on 1 January of `calendarYear`, in the Family's timezone. */
export const startOfYearInZone = (calendarYear: number, timeZone: string): Date =>
  instantOf({ year: calendarYear, month: 1, day: 1 }, timeZone);

export interface SetupDeadlineInput {
  readonly openedAt: Date;
  readonly calendarYear: number;
  readonly timezone: string;
}

/**
 * When the Setup Window closes and Boards Seal.
 *
 * Normally `YYYY-01-01T00:00:00` in the Family's timezone. If the Organizer opens the
 * Year later than seven days before that, the deadline becomes `openedAt + 7 days`
 * instead — nobody gets less than a week to author 24 Goals (PRD §5.2).
 */
export const setupDeadline = ({
  openedAt,
  calendarYear,
  timezone,
}: SetupDeadlineInput): Date => {
  const newYear = startOfYearInZone(calendarYear, timezone);
  const floor = openedAt.getTime() + MINIMUM_SETUP_WINDOW_DAYS * DAY_MS;
  return newYear.getTime() >= floor ? newYear : new Date(floor);
};

/**
 * A Member approved mid-Year gets a personal Setup Window of seven days (PRD §21.1).
 *
 * No proration follows from this, and none is needed: §13.5 removed ranking, so there
 * is no standing to be behind in (§21.5).
 */
export const lateJoinerDeadline = (approvedAt: Date): Date =>
  new Date(approvedAt.getTime() + MINIMUM_SETUP_WINDOW_DAYS * DAY_MS);

/**
 * How much of the Year is left, as a fraction of its full length.
 *
 * Passed to Sharpening so a July joiner is offered ≈70 walks rather than 300
 * (PRD §7.7, §21.3). Before the Year begins this is 1, so authoring during the Setup
 * Window proposes full-year targets.
 */
export const remainingYearFraction = (
  now: Date,
  calendarYear: number,
  timeZone: string,
): number => {
  const start = startOfYearInZone(calendarYear, timeZone).getTime();
  const end = startOfYearInZone(calendarYear + 1, timeZone).getTime();
  const remaining = (end - now.getTime()) / (end - start);
  return Math.min(1, Math.max(0, remaining));
};

/**
 * The instant a Year freezes: the moment 31 December ends in the Family's timezone
 * (PRD §20.1). Frozen Years are permanently read-only — no backdating.
 */
export const freezeInstant = (calendarYear: number, timeZone: string): Date =>
  startOfYearInZone(calendarYear + 1, timeZone);
