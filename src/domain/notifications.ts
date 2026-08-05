/**
 * What the notifications screen offers, and what it says (FRONTEND_DESIGN §4.8).
 *
 * The list lives here rather than in the screen because it is a product decision with a
 * server behind it, not a layout: each entry names a column on `notification_preferences`
 * (20260801000036), and every column there governs a `notifications.kind` that something
 * actually writes. §4.8 asks for five switches; two of them — the Centre moving and a Swap
 * — have no notification kind behind them at all, so they are absent rather than inert. A
 * preference that silently does nothing is worse than one that is missing: the Member who
 * turns it off and still hears about it has learned that the settings screen lies.
 *
 * The copy rules from §4.8 are not stylistic:
 *
 *   - **Every string names the Member and the thing.** Never "someone in your family" —
 *     hence "another Member", which is the word CONTEXT.md uses for a person's
 *     participation in one Family, rather than a vague stand-in for a name.
 *   - **Never count what the reader hasn't done**, never name a Member who hasn't logged,
 *     never end on a question, and never say anything about the reader's own inactivity.
 *   - **There is no daily reminder** — not off by default, *absent*, and the screen says
 *     so (§7.11: not in any form, under any name, in any experiment).
 *
 * Everything here is pure and imports nothing (`src/domain/boundaries.test.ts`).
 */

/** One switch: the column it writes, and what it is called out loud. */
export interface NotificationSwitch {
  /** The `notification_preferences` column. Also the test's and the query's key. */
  readonly id: 'tile_completed' | 'bingo_blackout' | 'almanac';
  readonly title: string;
  /** What arrives if it is on. Stated as the event, never as a benefit. */
  readonly detail: string;
}

/**
 * In the order §4.8 lists them, which is also the order they happen in a Year: squares
 * fall, then Lines close, then the Year ends.
 *
 * `bingo_blackout` is one switch over two kinds because §4.8 pairs them — a Member who
 * wants to hear about a Bingo wants to hear about a Blackout, and splitting them would
 * offer a choice nobody has.
 */
export const NOTIFICATION_SWITCHES: readonly NotificationSwitch[] = [
  {
    id: 'tile_completed',
    title: 'A square falls',
    detail: 'Another Member finishing a Tile. About one every couple of days.',
  },
  {
    id: 'bingo_blackout',
    title: 'Bingo and blackout',
    detail: 'Another Member closing their first Line, or filling all twenty-five squares.',
  },
  {
    id: 'almanac',
    title: 'The Almanac',
    detail: 'The story of the Year, once, the moment it freezes.',
  },
] as const;

/** §4.8's window. The server holds this same pair as the column defaults. */
export const QUIET_START = '21:00';
export const QUIET_END = '07:00';

/**
 * A Postgres `time` as a clock face.
 *
 * PostgREST returns `time` as `21:00:00`; nobody says the seconds. Display-only, and
 * nothing branches on it — an unparseable value is shown as it arrived rather than
 * replaced by a plausible-looking default, because a settings screen that quietly renders
 * 21:00 over the top of something else is a screen that cannot be trusted about the rest.
 */
export const hourMinute = (value: string): string =>
  /^\d{2}:\d{2}(:\d{2})?$/.test(value) ? value.slice(0, 5) : value;

/**
 * What quiet hours do, in the Family's own clock.
 *
 * Says the batching out loud, because a Member who turns this on and then finds four
 * pushes waiting at seven should have been told that is what "one line at 07:00" means.
 */
export const quietHoursDetail = (start: string, end: string): string =>
  `Nothing between ${hourMinute(start)} and ${hourMinute(end)}. Whatever happened arrives as one line at ${hourMinute(end)}.`;

/**
 * §19.1's Digest, which is per Family rather than per Account: it is one Family's week,
 * and someone in two Families has two answers.
 *
 * §19.3 is in the sentence on purpose — the Digest is never sent for a week in which
 * nothing happened, and saying so is what stops it reading as a weekly reminder (§7.11).
 */
export const DIGEST_DETAIL =
  'One summary of the week, on a Sunday evening. Never sent for a week with nothing in it.';

/**
 * The line that has to be on the screen (§4.8).
 *
 * > There is no daily reminder — not off by default, *absent*, and the settings screen
 * > says so.
 *
 * Stated as a fact about the app rather than as a promise or a boast, and it says what the
 * app does send in the same breath, because "no reminders" on its own reads as an omission
 * rather than a decision.
 */
export const NO_REMINDERS =
  'There is no daily reminder, and there will not be one. Everything here is somebody else’s news.';

/** §4.7, restated where a Guardian will read it before wondering. */
export const MANAGED_MEMBERS_HEAR_NOTHING =
  'A child’s profile is never sent anything, and nothing is ever sent on their behalf.';

/**
 * Where a tapped notification goes (§4.8: "a tap opens the Tile the notification is about,
 * not the app").
 *
 * `tileId` is absent on a Bingo, a Blackout and on every kind with no Milestone behind it —
 * the Board opens whole, which is the true answer rather than a square picked to fill the
 * field.
 */
export interface PushRoute {
  boardId: string;
  tileId?: string;
}

/**
 * Read a route out of a notification's `data` payload.
 *
 * Pure, and defensive on purpose: this is the one place in the app where a *remote* payload
 * turns into navigation. It arrives as `Record<string, unknown>` from the OS, it may have
 * been minted by a version of the Edge Function older than this build, and expo-notifications
 * does not promise the shape. Anything that is not two plain strings answers `null`, which
 * opens the app as before — the outcome every notification had until this slice.
 *
 * Ids are not verified here, and could not be: the Board this points at is behind
 * `boards_read`, so a payload naming a Board outside the Member's Family opens a screen
 * that shows them nothing. That is RLS doing its job (ADR-0004), not a check this function
 * could make honestly.
 */
export const pushRoute = (data: unknown): PushRoute | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { boardId, tileId } = data as { boardId?: unknown; tileId?: unknown };
  if (typeof boardId !== 'string' || boardId === '') return null;
  return typeof tileId === 'string' && tileId !== '' ? { boardId, tileId } : { boardId };
};
