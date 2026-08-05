import { describe, expect, it } from 'vitest';
import {
  WRAPPED_RAIL_SEGMENTS,
  awardExplanation,
  awardRows,
  grouped,
  monthName,
  monthOf,
  pluralUnit,
  shareText,
  wrappedDeck,
  type AwardRow,
  type FamilyStats,
  type MemberStats,
  type RosterEntry,
  type WrappedInput,
} from './wrapped';

const stats = (over: Partial<MemberStats> = {}): MemberStats => ({
  tilesCompleted: 18,
  tilesTotal: 25,
  linesCompleted: 5,
  linesTotal: 12,
  blackout: false,
  increments: 1312,
  biggestMonth: '2027-03',
  biggestMonthIncrements: 210,
  worstMonthIncrements: 4,
  comebackDelta: 206,
  longestGoalSpanDays: 240,
  longestGoal: 'Walk a mile',
  medianGapDays: 2.5,
  notes: 12,
  photos: 4,
  swapsUsed: 1,
  firstBingoAt: '2027-04-02T09:00:00Z',
  mostExceeded: { goal: 'Read a book', target: 12, actual: 18 },
  ...over,
});

const family = (over: Partial<FamilyStats> = {}): FamilyStats => ({
  increments: 2834,
  units: [
    { unit: 'walk', total: 2100 },
    { unit: 'book', total: 47 },
  ],
  categories: [
    { category: 'fitness', increments: 400 },
    { category: 'learning', increments: 600 },
  ],
  busiestMonth: '2027-03',
  familyGoal: { text: 'Camp somewhere with no signal', completed: true, completedBy: 'Ada' },
  milestones: [
    { member: 'Ada', type: 'tile_completed', at: '2027-02-11T12:00:00Z' },
    { member: 'Bo', type: 'bingo', at: '2027-05-01T12:00:00Z' },
  ],
  nextYear: 2028,
  ...over,
});

const roster: RosterEntry[] = [
  { id: 'm-ada', name: 'Ada', isManaged: false },
  { id: 'm-bo', name: 'Bo', isManaged: false },
  { id: 'm-cy', name: 'Cy', isManaged: true },
];

const input = (over: Partial<WrappedInput> = {}): WrappedInput => ({
  member: stats(),
  family: family(),
  awards: [],
  roster,
  calendarYear: 2027,
  timezone: 'UTC',
  nextYearState: 'openable',
  ...over,
});

describe('numbers and words', () => {
  it('groups thousands the way §20.5 writes them', () => {
    expect(grouped(2100)).toBe('2,100');
    expect(grouped(999)).toBe('999');
    expect(grouped(1234567)).toBe('1,234,567');
  });

  it('reads a YYYY-MM month without going through Date', () => {
    // `new Date('2027-03')` is UTC midnight and renders as February west of Greenwich,
    // undoing the timezone bucketing migration ..._029 §5 added.
    expect(monthName('2027-03')).toBe('March');
    expect(monthName('2027-12')).toBe('December');
    expect(monthName(null)).toBeNull();
  });

  it('reads a Milestone instant in the Family timezone, not UTC (§8.3 T1)', () => {
    // 1 March 00:30 UTC is still February in Los Angeles, and the Family's calendar is the
    // one that decides which month their year's events happened in.
    expect(monthOf('2027-03-01T00:30:00Z', 'UTC')).toBe('March');
    expect(monthOf('2027-03-01T00:30:00Z', 'America/Los_Angeles')).toBe('February');
  });

  it('survives a timezone the runtime has never heard of', () => {
    expect(monthOf('2027-03-11T12:00:00Z', 'Mars/Olympus_Mons')).toBe('March');
  });

  it('pluralises a canonical unit as a rule, not a dictionary (§7.10)', () => {
    expect(pluralUnit('book', 47)).toBe('books');
    expect(pluralUnit('book', 1)).toBe('book');
    expect(pluralUnit('mile', 3)).toBe('miles');
    expect(pluralUnit('class', 3)).toBe('classes');
    expect(pluralUnit('dish', 3)).toBe('dishes');
    expect(pluralUnit('mile', 1)).toBe('mile');
    expect(pluralUnit('city', 3)).toBe('cities');
    // A vowel before the y stays a plain s — "days", never "daies".
    expect(pluralUnit('day', 3)).toBe('days');
  });
});

describe('the deck (§20.4, §20.5, §20.6)', () => {
  it('is six cards, which is what §3 gives the rail six segments for', () => {
    const deck = wrappedDeck(input());
    expect(deck).toHaveLength(WRAPPED_RAIL_SEGMENTS);
    expect(deck.map((c) => c.kind)).toEqual([
      'personal',
      'personal',
      'family-totals',
      'family-story',
      'awards',
      'final',
    ]);
  });

  it('drops the personal cards for a Member who had no Board that Year', () => {
    // generate_wrapped() iterates `boards`, so a Member approved after this Year opened has
    // no wrapped_member_cards row at all. Four cards, not two blank ones.
    const deck = wrappedDeck(input({ member: null }));
    expect(deck.map((c) => c.kind)).toEqual([
      'family-totals',
      'family-story',
      'awards',
      'final',
    ]);
  });

  it('uses exactly two grounds, and personal cards are the moss one (§3)', () => {
    const deck = wrappedDeck(input());
    expect(new Set(deck.map((c) => c.ground))).toEqual(new Set(['moss', 'paper']));
    for (const card of deck) {
      expect(card.ground).toBe(card.kind === 'personal' ? 'moss' : 'paper');
    }
  });

  it('carries all ten personal facts of §20.4 across two cards, four cells each', () => {
    const [board, log] = wrappedDeck(input()) as [
      Extract<ReturnType<typeof wrappedDeck>[number], { kind: 'personal' }>,
      Extract<ReturnType<typeof wrappedDeck>[number], { kind: 'personal' }>,
    ];

    expect(board.numeral).toBe('18');
    expect(board.numeralCaption).toBe('of 25 tiles');
    expect(board.cells).toHaveLength(4);
    expect(board.cells.map((c) => c.value)).toEqual(['5 of 12', 'No', '1 of 3', '240 days']);
    expect(board.footnote).toBe('Walk a mile');

    expect(log.numeral).toBe('1,312');
    expect(log.cells).toHaveLength(4);
    expect(log.cells[0]?.value).toBe('March');
    expect(log.cells[3]?.value).toBe('18 of 12');
    expect(log.footnote).toBe('Read a book');
  });

  it('says No rather than a nudge when there was no blackout (§0.3)', () => {
    const [board] = wrappedDeck(input()) as [Extract<ReturnType<typeof wrappedDeck>[number], { kind: 'personal' }>];
    const blackout = board.cells.find((c) => c.caption === 'blackout');
    expect(blackout?.value).toBe('No');
    expect(JSON.stringify(board)).not.toMatch(/next year|try|almost|so close/i);
  });

  it('renders a Member who logged nothing without a single number that scolds', () => {
    const empty = stats({
      tilesCompleted: 0,
      linesCompleted: 0,
      increments: 0,
      biggestMonth: null,
      biggestMonthIncrements: 0,
      worstMonthIncrements: 0,
      comebackDelta: 0,
      longestGoalSpanDays: null,
      longestGoal: null,
      medianGapDays: null,
      notes: 0,
      photos: 0,
      swapsUsed: 0,
      firstBingoAt: null,
      mostExceeded: null,
    });
    const deck = wrappedDeck(input({ member: empty }));
    const personal = deck.filter((c) => c.kind === 'personal');
    expect(personal).toHaveLength(2);
    for (const card of personal) {
      expect(card.footnote).toBeNull();
      expect(card.reading).not.toMatch(/behind|missed|only|failed|should/i);
    }
  });

  it('gives every card one sensible reading (§6)', () => {
    for (const card of wrappedDeck(input())) {
      expect(card.reading.length).toBeGreaterThan(0);
      expect(card.reading).toContain(card.title.replace('?', ''));
    }
  });
});

describe('the Family cards (§20.5)', () => {
  it('aggregates units on the canonical form and admits what it left out (§20.8)', () => {
    const card = wrappedDeck(input()).find((c) => c.kind === 'family-totals')!;
    expect(card.units).toEqual(['2,100 walks', '47 books']);
    expect(card.unitsCaveat).not.toBeNull();
  });

  it('says nothing about units when the Family had none to group', () => {
    const card = wrappedDeck(input({ family: family({ units: [] }) })).find(
      (c) => c.kind === 'family-totals',
    )!;
    expect(card.units).toEqual([]);
    expect(card.unitsCaveat).toBeNull();
  });

  it('turns the category breakdown into whole percents (§20.5)', () => {
    const card = wrappedDeck(input()).find((c) => c.kind === 'family-totals')!;
    expect(card.categories.map((c) => c.text)).toEqual(['40% fitness', '60% learning']);
  });

  it('states the Family Goal outcome without blame when it did not happen', () => {
    const card = wrappedDeck(
      input({
        family: family({
          familyGoal: { text: 'Camp somewhere', completed: false, completedBy: null },
        }),
      }),
    ).find((c) => c.kind === 'family-story')!;
    expect(card.centre.body).toBe('Still open when the year closed.');
    expect(card.centre.body).not.toMatch(/fail|missed|sadly|unfortunately/i);
  });

  it('handles a Family who kept the middle square personal', () => {
    const card = wrappedDeck(input({ family: family({ familyGoal: null }) })).find(
      (c) => c.kind === 'family-story',
    )!;
    expect(card.centre.heading).toBe('The middle square');
  });

  it('renders the Milestone timeline whole and unfiltered (migration ..._029 §6)', () => {
    // Narrowing this list to Bingo and Blackout is what turned a timeline into "who got a
    // bingo first" — the one thing §13.5 names outright.
    const card = wrappedDeck(input()).find((c) => c.kind === 'family-story')!;
    expect(card.timeline.map((t) => t.text)).toEqual([
      'February · Ada finished a tile',
      'May · Bo got a bingo',
    ]);
    expect(card.timeline.map((t) => t.text).join(' ')).not.toMatch(/\b1st\b|first to|#\d/i);
  });

  it('never prints a raw Milestone type it does not recognise', () => {
    const card = wrappedDeck(
      input({
        family: family({
          milestones: [{ member: 'Ada', type: 'something_new', at: '2027-02-11T12:00:00Z' }],
        }),
      }),
    ).find((c) => c.kind === 'family-story')!;
    expect(card.timeline).toEqual([]);
  });
});

describe('the Awards (§20.7, §13.5a, ADR-0006)', () => {
  const awards: AwardRow[] = [
    { memberId: 'm-cy', axis: 'showed_up', label: 'Showed Up', detail: { reason: 'floor' } },
    { memberId: 'm-bo', axis: 'most_photos', label: 'Most Photos', detail: { photos: 31 } },
    { memberId: 'm-ada', axis: 'most_increments', label: 'Most Increments', detail: { increments: 1312 } },
    { memberId: 'm-ada', axis: 'first_bingo', label: 'First Bingo', detail: { at: '2027-04-02T09:00:00Z' } },
  ];

  it('renders in join order and in no other order, ever (§7.2)', () => {
    const card = wrappedDeck(input({ awards })).find((c) => c.kind === 'awards')!;
    expect(card.rows.map((r) => r.memberName)).toEqual(['Ada', 'Ada', 'Bo', 'Cy']);
    // Stable within a Member: the two Ada rows keep the order they arrived in rather than
    // gaining a ranking of their own.
    expect(card.rows.slice(0, 2).map((r) => r.label)).toEqual(['Most Increments', 'First Bingo']);
  });

  it('numbers nothing and implies no standing', () => {
    const card = wrappedDeck(input({ awards })).find((c) => c.kind === 'awards')!;
    const printed = card.rows.map((r) => `${r.label} ${r.explanation}`).join(' ');
    expect(printed).not.toMatch(/\b1st\b|\b2nd\b|\brank\b|\bplace\b|\bwinner\b|\bbeat\b|\bthan\b/i);
    expect(card.blurb).toMatch(/no order/i);
  });

  it('gives the floor Award no number at all', () => {
    // `showed_up` reaches a Member the ten comparative axes cannot, and its detail is
    // either {increments: 0} or {reason: 'floor'}. "0 increments" is a scold either way.
    expect(awardExplanation('showed_up', { increments: 0 }, 'UTC')).toBe('On the board all year.');
    expect(awardExplanation('showed_up', { reason: 'floor' }, 'UTC')).not.toMatch(/\d/);
  });

  it('explains every axis the server CHECK allows', () => {
    const axes = [
      'most_increments', 'biggest_single_month', 'most_consistent', 'longest_running_goal',
      'best_comeback', 'most_photos', 'most_notes', 'first_bingo', 'most_exceeded_target',
      'quietest_achiever', 'showed_up',
    ];
    for (const axis of axes) {
      expect(awardExplanation(axis, {}, 'UTC'), axis).not.toBe('');
    }
  });

  it('reads each axis from the detail assignAwards actually wrote', () => {
    expect(awardExplanation('most_increments', { increments: 1312 }, 'UTC'))
      .toBe('1,312 increments across the year.');
    expect(awardExplanation('most_consistent', { medianGapDays: 2.46 }, 'UTC'))
      .toBe('About 2.5 days between increments, all year.');
    expect(awardExplanation('most_consistent', { medianGapDays: 0.5 }, 'UTC'))
      .toBe('Rarely a whole day between increments.');
    expect(awardExplanation('longest_running_goal', { days: 240 }, 'UTC'))
      .toBe('Stayed with one goal for 240 days.');
    expect(awardExplanation('most_exceeded_target', { ratio: 1.5 }, 'UTC'))
      .toBe('1.5× the target on one goal.');
    expect(awardExplanation('first_bingo', { at: '2027-04-02T09:00:00Z' }, 'UTC'))
      .toBe('A line closed in April.');
    expect(awardExplanation('quietest_achiever', { increments: 31 }, 'UTC'))
      .toBe('Closed a line on 31 increments.');
  });

  it('survives an axis a newer server invented rather than printing it raw', () => {
    expect(awardExplanation('most_something', {}, 'UTC')).toBe('');
  });

  it('drops a row whose Member has since left the Family', () => {
    const rows = awardRows(
      [{ memberId: 'gone', axis: 'most_notes', label: 'Most Notes Written', detail: { notes: 9 } }],
      roster,
      'UTC',
    );
    expect(rows).toEqual([]);
  });

  it('carries the Managed flag so the clay dot follows a child everywhere (§3)', () => {
    const rows = awardRows(
      [{ memberId: 'm-cy', axis: 'showed_up', label: 'Showed Up', detail: {} }],
      roster,
      'UTC',
    );
    expect(rows[0]?.isManaged).toBe(true);
  });
});

describe('the final card (§20.6, §20.11)', () => {
  it('is not a stat, and offers the year family_cards named', () => {
    const card = wrappedDeck(input()).find((c) => c.kind === 'final')!;
    expect(card.title).toBe('Ready for 2028?');
    expect(card.action).toEqual({ label: 'Open 2028', year: 2028 });
    expect(card.body).toMatch(/nothing carries over/i);
  });

  it('offers no button to somebody open_year() would refuse', () => {
    // 42501 for a non-Organizer, PT409 for a Year the Family already has. A button the
    // server will refuse is the trap this repo has already been bitten by.
    for (const state of ['already-open', 'not-yours', 'past'] as const) {
      const card = wrappedDeck(input({ nextYearState: state })).find((c) => c.kind === 'final')!;
      expect(card.action).toBeNull();
      expect(card.body.length).toBeGreaterThan(0);
    }
  });

  it('still renders when the materialized row has no next year', () => {
    const card = wrappedDeck(
      input({ family: family({ nextYear: null }) }),
    ).find((c) => c.kind === 'final')!;
    expect(card.title).toBe('Ready?');
    expect(card.action).toBeNull();
  });
});

describe('the Share button (§20.9)', () => {
  const shared = shareText(2027, stats());

  it('is the Member’s own stats and reads like a sentence', () => {
    expect(shared).toBe('My 2027: 18 of 25 tiles, 5 of 12 lines, 1,312 increments.');
  });

  it('names nobody — not another Member, not a child, not the sharer', () => {
    for (const name of ['Ada', 'Bo', 'Cy']) {
      expect(shared).not.toContain(name);
    }
  });

  it('carries no Goal text, no note, no photo and no Award', () => {
    // A Goal is a sentence somebody wrote about their own life, and §20.9 says stats only.
    expect(shared).not.toContain('Walk a mile');
    expect(shared).not.toContain('Read a book');
    expect(shared).not.toMatch(/photo|award|camp/i);
  });

  it('mentions a blackout, because that one is a number too', () => {
    expect(shareText(2027, stats({ blackout: true }))).toMatch(/and a blackout\.$/);
  });

  it('is what the personal cards hand to the Share button', () => {
    const personal = wrappedDeck(input()).filter((c) => c.kind === 'personal');
    for (const card of personal) expect(card.share).toBe(shared);
  });
});
