/**
 * Wrapped — the deck of cards a finished Year turns into, and every word printed on them
 * (PRD §20.4–§20.9, FRONTEND_DESIGN §3 `<WrappedCard>`, §4 "Copy voice").
 *
 * Wrapped is *generated once at Freeze and materialized* (§20.2), so nothing here computes
 * a statistic — the numbers arrive settled and this module only decides which card carries
 * which of them and how each one reads. That split is the point: the copy voice ("warm,
 * brief, occasionally funny, never coachy") is enforced once, in one file with a test suite,
 * instead of in fifteen branches of JSX where the fourteenth quietly says "You're on track!".
 *
 * Three rules are load-bearing rather than stylistic, and each one has a test:
 *
 *   1. **Awards are never ranked** (§20.7, §13.5a, ADR-0006). They arrive as rows and are
 *      re-ordered only into the Family's join order — never by axis strength, never by any
 *      number on the row, never numbered. See `awardRows`.
 *   2. **Awards are never computed here.** `assignAwards()` in ./awards.ts belongs to the
 *      `wrap` Edge Function and must not gain a second caller; a client that recomputed
 *      them could disagree with the row a Member was actually given.
 *   3. **The share text is the Member's own stats and nothing else** (§20.9). No name, no
 *      goal text, no other Member, no photo. A one-tap button that publishes a child's
 *      name is the *app's* design decision, not the Member's (ADR-0006, ADR-0005).
 *
 * Pure (PRD §13.6): no imports, no I/O, and no React. `Intl` is used for one thing and the
 * reason is spelled out at `monthOf`.
 */

/* ------------------------------------------------------------------------------------- *
 * The materialized rows, in the client's own casing.
 *
 * These mirror `wrapped_member_cards.stats` and `wrapped.family_cards` exactly, and the
 * mirroring is checked by the CHECK constraint `stats_has_the_cards` on the server side and
 * by lib/queries/wrapped.ts on this one. A key that arrives missing renders as a hole in a
 * card, on a Year that can never be regenerated — which is why the query layer normalizes
 * rather than casting.
 * ------------------------------------------------------------------------------------- */

/** One Member's Year (§20.4). `stats` in `wrapped_member_cards`. */
export interface MemberStats {
  readonly tilesCompleted: number;
  /** Always 25, but stored rather than assumed — the card states what was materialized. */
  readonly tilesTotal: number;
  readonly linesCompleted: number;
  /** Always 12 (§13.1). */
  readonly linesTotal: number;
  readonly blackout: boolean;
  readonly increments: number;
  /** `"YYYY-MM"`, bucketed server-side in the Family's timezone (§8.3 T3). */
  readonly biggestMonth: string | null;
  readonly biggestMonthIncrements: number;
  readonly worstMonthIncrements: number;
  /** Best month minus worst. An Award input (§20.7 Best Comeback), not a card of its own. */
  readonly comebackDelta: number;
  readonly longestGoalSpanDays: number | null;
  /** Which Goal that span belonged to — the Member's own words. */
  readonly longestGoal: string | null;
  readonly medianGapDays: number | null;
  readonly notes: number;
  readonly photos: number;
  readonly swapsUsed: number;
  readonly firstBingoAt: string | null;
  /** Target vs actual on the Goal they most exceeded (§20.4). `null` if they exceeded none. */
  readonly mostExceeded: { readonly goal: string; readonly target: number; readonly actual: number } | null;
}

/** The Family's Year (§20.5). `family_cards` in `wrapped`. */
export interface FamilyStats {
  readonly increments: number;
  /**
   * Grouped on `unit_canonical`, so one Member's "Books" and another's "book" add up
   * (CONTEXT.md, Unit). Goals that skipped Sharpening have no canonical unit and the server
   * left them out (§20.8) — which is why the card carries a caveat rather than a total.
   */
  readonly units: readonly { readonly unit: string; readonly total: number }[];
  readonly categories: readonly { readonly category: string; readonly increments: number }[];
  /** `"YYYY-MM"`, in the Family's timezone. */
  readonly busiestMonth: string | null;
  readonly familyGoal: {
    readonly text: string;
    readonly completed: boolean;
    readonly completedBy: string | null;
  } | null;
  /**
   * Every Milestone of the Year, in order, unfiltered.
   *
   * The filter was the bug: narrowing this to Bingo and Blackout produced a chronological
   * list of who got a Bingo first, which is precisely the "first to bingo" §13.5 forbids
   * (migration `..._029` §6). Unfiltered it is hundreds of Tiles closing and reads as a
   * story rather than a race — so this list is rendered whole, and nothing here may sort,
   * rank or trim it.
   */
  readonly milestones: readonly {
    readonly member: string;
    readonly type: string;
    readonly at: string;
  }[];
  readonly nextYear: number | null;
}

/** A row of `wrapped_awards`, with the Member's name already resolved from the roster. */
export interface AwardRow {
  readonly memberId: string;
  readonly axis: string;
  /** The server's wording. Superlative or factual — `assignAwards()` decided which. */
  readonly label: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** A Member as the roster knows them, in **join order** (§7.2). */
export interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly isManaged: boolean;
}

/**
 * Whether the caller can actually open the next Year from the final card.
 *
 * `open_year()` refuses anyone who is not the Organizer (42501) and refuses a Year the
 * Family already has (PT409), so the button has to know both. This repo has shipped a
 * button the server refused before — a `disabled` gate built from data a role cannot read
 * (see the handoff) — and the fix is the same each time: decide it from the same facts the
 * function checks, and say something true when the answer is no.
 */
export type NextYearState =
  /** Organizer, and the Year is free. */
  | 'openable'
  /** Somebody already opened it. */
  | 'already-open'
  /** Not the Organizer's to open (§5.1). */
  | 'not-yours'
  /**
   * The Year after this one has itself already ended.
   *
   * §20.10 keeps frozen Years browsable forever, so somebody reading their 2027 Wrapped in
   * 2031 gets a final card offering to open 2028 — which `open_year()` refuses outright
   * with 22023, "that Year has already passed".
   */
  | 'past';

export interface WrappedInput {
  /** The caller's own Member card. `null` for a Member who had no Board this Year (§21). */
  readonly member: MemberStats | null;
  readonly family: FamilyStats;
  readonly awards: readonly AwardRow[];
  /** Join order, and only join order — the order the Awards list renders in. */
  readonly roster: readonly RosterEntry[];
  /** The Year that just froze. */
  readonly calendarYear: number;
  /** The Family's IANA zone (§8.3 T1). Milestone months are read in it, not in UTC. */
  readonly timezone: string;
  readonly nextYearState: NextYearState;
}

/* ------------------------------------------------------------------------------------- *
 * The cards
 * ------------------------------------------------------------------------------------- */

/** One cell of a personal card's 2×2 hairline grid (§3). */
export interface StatCell {
  readonly value: string;
  readonly caption: string;
}

/** A category slice of the Family's Year. `share` is a whole percent (§20.5, "40% fitness"). */
export interface CategorySlice {
  readonly category: string;
  readonly share: number;
  readonly text: string;
}

interface CardBase {
  /** Stable across renders and across Members — the pager's key. */
  readonly id: string;
  /**
   * `moss` is §3's `mossDeep` ground with `paper` text; `paper` is `paper` with `ink`.
   * Two grounds, and no third — Wrapped has no dark mode (§1.2, §7.12).
   */
  readonly ground: 'moss' | 'paper';
  readonly title: string;
  /**
   * The whole card as one sentence, for a screen reader.
   *
   * §6 asks each card to be "one sensible reading" rather than eleven fragments. The
   * component hangs this on the card's content block — never on the card itself, because an
   * `accessible` container collapses its subtree on iOS and would swallow the Share button
   * with it (the handoff's fourth slice-10 trap).
   */
  readonly reading: string;
}

export interface PersonalCard extends CardBase {
  readonly kind: 'personal';
  readonly ground: 'moss';
  /** The one big Shippori numeral, 118pt/.9 (§3). One number per card. */
  readonly numeral: string;
  readonly numeralCaption: string;
  /** Exactly four, so the 2×2 grid is always square. */
  readonly cells: readonly [StatCell, StatCell, StatCell, StatCell];
  /** The Member's own words, when a cell above refers to a Goal they wrote. */
  readonly footnote: string | null;
  /** §20.9 — this Member's own stats, and nothing else in the world. */
  readonly share: string;
}

export interface FamilyTotalsCard extends CardBase {
  readonly kind: 'family-totals';
  readonly ground: 'paper';
  readonly headline: string;
  readonly units: readonly string[];
  /** Said whenever units are shown, because §20.8 means the list is never the whole story. */
  readonly unitsCaveat: string | null;
  readonly categories: readonly CategorySlice[];
  readonly busiestMonth: string | null;
}

export interface FamilyStoryCard extends CardBase {
  readonly kind: 'family-story';
  readonly ground: 'paper';
  /** The Family Goal outcome, which §3 puts in a `clayTint` block. Clay means family. */
  readonly centre: { readonly heading: string; readonly body: string };
  /** Chronological, unfiltered, unnumbered. */
  readonly timeline: readonly { readonly id: string; readonly text: string }[];
}

export interface AwardsCard extends CardBase {
  readonly kind: 'awards';
  readonly ground: 'paper';
  readonly blurb: string;
  readonly rows: readonly {
    readonly id: string;
    readonly memberId: string;
    readonly memberName: string;
    readonly isManaged: boolean;
    readonly label: string;
    readonly explanation: string;
  }[];
}

export interface FinalCard extends CardBase {
  readonly kind: 'final';
  readonly ground: 'paper';
  readonly body: string;
  readonly nextYear: number | null;
  /** Rendered only when `open_year()` would actually accept the call. */
  readonly action: { readonly label: string; readonly year: number } | null;
}

export type WrappedCardModel =
  | PersonalCard
  | FamilyTotalsCard
  | FamilyStoryCard
  | AwardsCard
  | FinalCard;

/**
 * §3's rail is six segments, and the ordinary deck is six cards: two personal, two Family,
 * the Awards, and the one that is not a stat.
 *
 * A Member who had no Board in this Year has no `wrapped_member_cards` row — `generate_wrapped`
 * iterates `boards` — so their deck is the four Family-wide cards and the rail is four long.
 * That is a real case rather than a hypothetical: a Member approved after a Year opened is
 * dealt a Board on the Year current at that moment and has none in the one before it.
 */
export const WRAPPED_RAIL_SEGMENTS = 6;

/* ------------------------------------------------------------------------------------- *
 * Words and numbers
 * ------------------------------------------------------------------------------------- */

/**
 * Thousands separators, written out rather than delegated to `toLocaleString`.
 *
 * §20.5's own example is "2,100 times", so the grouping is part of the copy. A locale-aware
 * format would render it as "2 100" on a French handset inside an English sentence, which
 * is worse than being uniformly English in an app whose every other word is.
 */
export const grouped = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * `"2027-03"` → `"March"`.
 *
 * A string split rather than `new Date("2027-03")`, which parses as UTC midnight and then
 * renders as February to anybody west of Greenwich — turning a stat the server carefully
 * bucketed in the Family's timezone (§8.3 T3, migration `..._029` §5) back into the bug
 * that migration fixed.
 */
export const monthName = (yyyymm: string | null): string | null => {
  if (yyyymm === null) return null;
  const month = Number(yyyymm.slice(5, 7));
  return MONTHS[month - 1] ?? null;
};

/**
 * The month an instant falls in, read where the Family lives.
 *
 * Milestones carry a raw `timestamptz` rather than a pre-bucketed month, so this is the one
 * place the client does the conversion the server did for `biggest_month`. `Intl` rather
 * than arithmetic: a fixed offset is wrong for half the year in half the world, and "which
 * month was that" is exactly the question §8.3 T1 says to answer in the Family's zone.
 */
export const monthOf = (iso: string, timezone: string): string | null => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en', { month: 'long', timeZone: timezone }).format(at);
  } catch {
    // A handset can report a zone newer than the runtime's tzdata, the same way it can
    // report one newer than the server's (see useCreateFamily). A missing month name is
    // not worth losing the line over.
    return new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(at);
  }
};

/**
 * A canonical Unit, pluralised.
 *
 * `unit_canonical` is a singular lowercase noun by §7.10 — `"book"` for a Member who typed
 * `Books` — and §20.5's copy is "47 books". This is a rule, not a dictionary, for the same
 * reason `incrementVerb`'s table is deliberately short: growing it into a dictionary is not
 * the fix if the copy disappoints. It is only ever read beside its own number, so "1 book"
 * and "47 books" are the only two shapes that have to be right.
 */
export const pluralUnit = (unit: string, n: number): string => {
  if (n === 1) return unit;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
};

/** `n` with a noun that agrees with it. */
const count = (n: number, singular: string, plural = `${singular}s`): string =>
  `${grouped(n)} ${n === 1 ? singular : plural}`;

/** One decimal place, and no trailing `.0` — "2× the target", not "2.0×". */
const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10);

/** A `detail` value that should be a number, or `null` if the row does not carry one. */
const detailNumber = (detail: Readonly<Record<string, unknown>>, key: string): number | null => {
  const value = detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const detailString = (detail: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = detail[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

/* ------------------------------------------------------------------------------------- *
 * Awards
 * ------------------------------------------------------------------------------------- */

/**
 * The one line of `ink2` under an Award's name (§3).
 *
 * It states the number on the row and nothing else. It never compares, never says "most",
 * never says "than", and never mentions another Member — the *label* already carries
 * whatever superlative `assignAwards()` judged to be true, and a second sentence restating
 * it in the client is a second author for the same claim.
 *
 * `showed_up` is the case worth being careful about. It is the floor for a Member the ten
 * comparative axes cannot reach (§20.7, migration `..._029` §7), so its `detail` is either
 * `{increments: 0}` or `{reason: "floor"}` depending on whether `assignAwards()` or the SQL
 * inserted it — and either way "0 increments" is a sentence that scolds somebody for their
 * quiet year, which §0.3 forbids outright. It gets no number at all.
 */
export const awardExplanation = (
  axis: string,
  detail: Readonly<Record<string, unknown>>,
  timezone: string,
): string => {
  const n = (key: string) => detailNumber(detail, key);
  switch (axis) {
    case 'most_increments':
      return `${count(n('increments') ?? 0, 'increment')} across the year.`;
    case 'biggest_single_month':
      return `${count(n('increments') ?? 0, 'increment')} inside one month.`;
    case 'most_consistent': {
      const gap = n('medianGapDays');
      if (gap === null) return 'Never left it long.';
      return gap < 1
        ? 'Rarely a whole day between increments.'
        : `About ${oneDecimal(gap)} days between increments, all year.`;
    }
    case 'longest_running_goal': {
      const days = n('days');
      return days === null
        ? 'Stayed with one goal.'
        : `Stayed with one goal for ${count(days, 'day')}.`;
    }
    case 'best_comeback': {
      const delta = n('increments');
      return delta === null
        ? 'The end of the year looked nothing like the start.'
        : `${count(delta, 'increment')} between their quietest month and their best.`;
    }
    case 'most_photos':
      return `${count(n('photos') ?? 0, 'photo')} hung on the year.`;
    case 'most_notes':
      return `${count(n('notes') ?? 0, 'note')} written along the way.`;
    case 'first_bingo': {
      const at = detailString(detail, 'at');
      const month = at === null ? null : monthOf(at, timezone);
      return month === null ? 'Closed a line.' : `A line closed in ${month}.`;
    }
    case 'most_exceeded_target': {
      const ratio = n('ratio');
      return ratio === null
        ? 'Went past the number.'
        : `${oneDecimal(ratio)}× the target on one goal.`;
    }
    case 'quietest_achiever': {
      const increments = n('increments');
      return increments === null
        ? 'Closed a line without making a sound.'
        : `Closed a line on ${count(increments, 'increment')}.`;
    }
    case 'showed_up':
      // No number. See the note above.
      return 'On the board all year.';
    default:
      // An axis this build has not heard of. The server's `award_axis_known` CHECK means
      // that can only be a newer server than client, and a blank line under a real Award is
      // better than a guess about what it measured.
      return '';
  }
};

/**
 * The Awards, as a flat list in the Family's join order (§7.2, §20.7, §13.5a).
 *
 * **Join order is the entire ordering rule.** Not by axis strength, not by the number in
 * `detail`, not by how many Awards a Member has, not alphabetically by label — every one of
 * those reads as a standing, and Wrapped runs days before next Year's goal-setting, so
 * whatever this list appears to rank is what the Family optimises for in January (ADR-0006).
 * `sort` is stable, so a Member holding two Awards keeps whatever order the rows arrived in
 * rather than gaining an internal ranking of their own.
 *
 * A row whose Member is not on the roster is dropped rather than rendered nameless: the
 * only way that happens is a Member removed since the Freeze (§3.4), and naming an empty
 * avatar in an Award list is worse than a shorter list.
 */
export const awardRows = (
  awards: readonly AwardRow[],
  roster: readonly RosterEntry[],
  timezone: string,
): AwardsCard['rows'] => {
  const order = new Map(roster.map((m, index) => [m.id, index]));
  const byId = new Map(roster.map((m) => [m.id, m]));

  return awards
    .filter((a) => byId.has(a.memberId))
    .slice()
    .sort((a, b) => (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0))
    .map((a) => {
      const member = byId.get(a.memberId)!;
      return {
        // Unique per row: `(member, axis)` is the table's own unique key.
        id: `${a.memberId}:${a.axis}`,
        memberId: a.memberId,
        memberName: member.name,
        isManaged: member.isManaged,
        label: a.label,
        explanation: awardExplanation(a.axis, a.detail, timezone),
      };
    });
};

/* ------------------------------------------------------------------------------------- *
 * §20.9 — the export
 * ------------------------------------------------------------------------------------- */

/**
 * The Share button's payload: **the Member's own card, stats only** (§20.9).
 *
 * Deliberately every kind of empty. No name — not even their own, because a Member's name
 * in a Family of five is a fair guess at four other people's surname. No Goal text, because
 * a Goal is a sentence somebody wrote about their own life. No Milestone, because those
 * carry other Members. No Award, because an Award names the Family that gave it.
 *
 * The full Family Wrapped is in-app only. A screenshot is always possible and that is the
 * Member's call; a one-tap button that publishes a child's name is the app's (ADR-0006).
 */
export const shareText = (calendarYear: number, stats: MemberStats): string => {
  const lines = [
    `My ${calendarYear}:`,
    `${stats.tilesCompleted} of ${stats.tilesTotal} tiles`,
    `${stats.linesCompleted} of ${stats.linesTotal} lines`,
    count(stats.increments, 'increment'),
  ];
  if (stats.blackout) lines.push('and a blackout');
  return `${lines[0]} ${lines.slice(1).join(', ')}.`;
};

/* ------------------------------------------------------------------------------------- *
 * The deck
 * ------------------------------------------------------------------------------------- */

/**
 * One card, one sentence (§6), built from the very strings the card prints.
 *
 * Not written twice. A screen reader hearing different words from the ones on the screen is
 * two apps, and the second one is the one nobody proof-reads.
 */
const withReading = (card: PersonalCard): PersonalCard => ({
  ...card,
  reading: [
    `${card.title}.`,
    `${card.numeral} ${card.numeralCaption}.`,
    ...card.cells.map((c) => `${c.caption}: ${c.value}.`),
    card.footnote === null ? '' : `${card.footnote}.`,
  ]
    .filter((s) => s !== '')
    .join(' '),
});

const personalCards = (
  stats: MemberStats,
  calendarYear: number,
): [PersonalCard, PersonalCard] => {
  const spanDays = stats.longestGoalSpanDays;
  const exceeded = stats.mostExceeded;
  const biggest = monthName(stats.biggestMonth);

  // §20.4 lists ten personal facts. Two cards, one big numeral each and four cells under it,
  // is exactly ten — so nothing has to be dropped and nothing has to be invented to fill a
  // grid. The split is by what a Member was looking at: the board, then the log.
  const board: PersonalCard = {
    kind: 'personal',
    ground: 'moss',
    id: 'your-board',
    title: 'Your board',
    numeral: String(stats.tilesCompleted),
    numeralCaption: `of ${stats.tilesTotal} tiles`,
    cells: [
      { value: `${stats.linesCompleted} of ${stats.linesTotal}`, caption: 'lines' },
      // Plain yes or no. "Not this year" is a nudge toward next year wearing a fact's
      // clothes, and §0.3 has no room for one.
      { value: stats.blackout ? 'Yes' : 'No', caption: 'blackout' },
      { value: `${stats.swapsUsed} of 3`, caption: stats.swapsUsed === 1 ? 'swap' : 'swaps' },
      spanDays === null || spanDays <= 0
        ? { value: 'None', caption: 'longest-running goal' }
        : { value: count(spanDays, 'day'), caption: 'longest-running goal' },
    ],
    footnote: spanDays === null || spanDays <= 0 ? null : stats.longestGoal,
    share: shareText(calendarYear, stats),
    reading: '',
  };

  const log: PersonalCard = {
    kind: 'personal',
    ground: 'moss',
    id: 'your-log',
    title: 'You logged',
    numeral: grouped(stats.increments),
    numeralCaption: stats.increments === 1 ? 'increment' : 'increments',
    cells: [
      biggest === null
        ? { value: 'None', caption: 'busiest month' }
        : { value: biggest, caption: `${count(stats.biggestMonthIncrements, 'increment')} · busiest month` },
      { value: grouped(stats.notes), caption: stats.notes === 1 ? 'note' : 'notes' },
      { value: grouped(stats.photos), caption: stats.photos === 1 ? 'photo' : 'photos' },
      exceeded === null
        ? { value: 'None', caption: 'went past the target' }
        : {
            value: `${grouped(exceeded.actual)} of ${grouped(exceeded.target)}`,
            caption: 'went past the target',
          },
    ],
    footnote: exceeded?.goal ?? null,
    share: shareText(calendarYear, stats),
    reading: '',
  };

  return [withReading(board), withReading(log)];
};

const familyTotalsCard = (family: FamilyStats): FamilyTotalsCard => {
  const totalCategorised = family.categories.reduce((sum, c) => sum + c.increments, 0);
  const categories: CategorySlice[] = family.categories.map((c) => {
    const share = totalCategorised === 0 ? 0 : Math.round((c.increments / totalCategorised) * 100);
    return { category: c.category, share, text: `${share}% ${c.category}` };
  });

  const units = family.units.map((u) => `${grouped(u.total)} ${pluralUnit(u.unit, u.total)}`);
  const busiest = monthName(family.busiestMonth);

  const headline =
    family.increments === 0
      ? 'A quiet one.'
      : `${count(family.increments, 'increment')} between you.`;

  const card: FamilyTotalsCard = {
    kind: 'family-totals',
    ground: 'paper',
    id: 'together',
    title: 'Together',
    headline,
    units,
    // §20.8: Goals that skipped Sharpening have no canonical Unit and the server left them
    // out of this aggregation only. Not re-filtered here — but not passed off as the whole
    // year either, which is the other way to get §20.8 wrong.
    unitsCaveat: units.length === 0 ? null : 'Goals counted in their own units. The rest are in the total above.',
    categories,
    busiestMonth: busiest,
    reading: [
      'Together.',
      headline,
      units.length === 0 ? '' : `${units.join(', ')}.`,
      categories.length === 0 ? '' : `${categories.map((c) => c.text).join(', ')}.`,
      busiest === null ? '' : `${busiest} was the busiest month.`,
    ]
      .filter((s) => s !== '')
      .join(' '),
  };
  return card;
};

/** What a Milestone reads as in the Family's timeline. Never a rank, never a placing. */
const milestoneLine = (type: string, member: string): string | null => {
  switch (type) {
    case 'tile_completed':
      return `${member} finished a tile`;
    case 'bingo':
      return `${member} got a bingo`;
    case 'line_completed':
      return `${member} closed a line`;
    case 'blackout':
      return `${member} blacked out the whole board`;
    default:
      // A kind this build does not know. Dropped rather than printed raw: `line_completed`
      // rendered as "line_completed" is the sort of thing that reads as a broken app.
      return null;
  }
};

const familyStoryCard = (family: FamilyStats, timezone: string): FamilyStoryCard => {
  const goal = family.familyGoal;

  // Clay means family, and this block is the Family Goal outcome §3 puts on `clayTint`.
  // Nothing here can scold: a shared Goal nobody finished is a fact about a year, and §0.3
  // rules out an empty state that implies failure.
  const centre =
    goal === null
      ? {
          heading: 'The middle square',
          body: 'Everyone wrote their own. Twenty-five squares each, no shared one.',
        }
      : goal.completed
        ? {
            heading: goal.text,
            body:
              goal.completedBy === null
                ? 'Done — and it completed every board at once.'
                : `Done. ${goal.completedBy} marked it, and it completed every board at once.`,
          }
        : { heading: goal.text, body: 'Still open when the year closed.' };

  // Rendered whole. Trimming it would mean choosing which Milestones matter, and every rule
  // for choosing is a filter — which is exactly what turned this list into a ranking once
  // already (migration `..._029` §6). The card scrolls instead.
  const timeline = family.milestones.flatMap((m, index) => {
    const line = milestoneLine(m.type, m.member);
    if (line === null) return [];
    const month = monthOf(m.at, timezone);
    return [{ id: `${index}`, text: month === null ? line : `${month} · ${line}` }];
  });

  return {
    kind: 'family-story',
    ground: 'paper',
    id: 'the-story',
    title: 'How it went',
    centre,
    timeline,
    reading: [
      'How it went.',
      `${centre.heading}. ${centre.body}`,
      timeline.length === 0
        ? 'Nothing was recorded this year.'
        : `${count(timeline.length, 'milestone')}, in order.`,
    ].join(' '),
  };
};

const awardsCard = (
  awards: readonly AwardRow[],
  roster: readonly RosterEntry[],
  timezone: string,
): AwardsCard => {
  const rows = awardRows(awards, roster, timezone);
  // States the rule instead of preaching it. §20.7 forbids a standing; saying so once, in
  // the Family's own words, is what stops somebody reading the list as one anyway.
  const blurb = 'Different things, measured differently. There is no order to this list.';
  return {
    kind: 'awards',
    ground: 'paper',
    id: 'awards',
    title: 'Awards',
    blurb,
    rows,
    // The rows are not in here. Each Award is its own focusable element with its own
    // sentence, so folding them into the card's reading would say every name twice — and
    // the summary's job is to explain the order *before* the names arrive, since a list of
    // people read aloud in sequence is the one shape most likely to be heard as a standing.
    reading: `Awards. ${blurb} ${count(rows.length, 'award')}, in the order everyone joined the family.`,
  };
};

const finalCard = (nextYear: number | null, state: NextYearState): FinalCard => {
  // §20.6: the final card is not a stat. "Ready for 2028?", 25 empty tiles, and a moss
  // button straight into opening the next Year.
  const title = nextYear === null ? 'Ready?' : `Ready for ${nextYear}?`;

  // §20.11 — opening the next Year carries nothing over. Said plainly, because a Member who
  // expects their unfinished Goals to roll forward will write next year's board wrong.
  const fresh = 'Nothing carries over. New goals, a new middle square, twenty-five empty squares each.';

  const body =
    state === 'openable'
      ? fresh
      : state === 'already-open'
        ? `${fresh} ${nextYear === null ? 'It is already open.' : `${nextYear} is already open — your board is waiting.`}`
        : state === 'not-yours'
          ? `${fresh} The organizer opens it when everyone is ready.`
          : // Looking back from further on. §20.10 says a frozen Year and its Wrapped stay
            // browsable forever, so this card has to make sense years later — and offering
            // to open a Year that has itself already ended would only earn a 22023.
            'This one is finished, and it stays here for good.';

  return {
    kind: 'final',
    ground: 'paper',
    id: 'ready',
    title,
    body,
    nextYear,
    action:
      state === 'openable' && nextYear !== null
        ? { label: `Open ${nextYear}`, year: nextYear }
        : null,
    reading: `${title} ${body}`,
  };
};

/**
 * The whole deck, in the order it is swiped through (§20.4 → §20.5 → §20.6).
 *
 * Personal first, because Wrapped opens on the Member's own year and the Family's is the
 * context around it. The Awards come after both, so that by the time somebody's name is on
 * a card the reader has already seen that the axes measure unrelated things. The final card
 * is last and is not a stat — it is the reason this slice exists at all, since Wrapped lands
 * days before the next Setup Window and being forgotten before year two is the default
 * outcome for an annual app (§20).
 */
export const wrappedDeck = (input: WrappedInput): WrappedCardModel[] => [
  ...(input.member === null ? [] : personalCards(input.member, input.calendarYear)),
  familyTotalsCard(input.family),
  familyStoryCard(input.family, input.timezone),
  awardsCard(input.awards, input.roster, input.timezone),
  finalCard(input.family.nextYear, input.nextYearState),
];
