import { describe, expect, it } from 'vitest';
import {
  daysUntilSeal,
  hasOpenSetupWindow,
  openableYear,
  playHasOpened,
  playOpensCopy,
  relevantYear,
  sealCopy,
  setupDeadline,
} from './year';

const at = (iso: string) => new Date(iso);

describe('openableYear (§5.1)', () => {
  it('offers the year that is happening, so a Family formed in March can play now', () => {
    // The seven-day floor means the current year always has a usable window, and
    // open_year() only refuses one that has already ended. Offering only 2028 left a
    // March Family with no Board until January.
    expect(openableYear(at('2027-03-01T12:00:00Z'), 'UTC', [])).toBe(2027);
  });

  it('moves to next year once this one is open', () => {
    expect(openableYear(at('2027-03-01T12:00:00Z'), 'UTC', [2027])).toBe(2028);
  });

  it('offers nothing once both are open — §5.1 allows one per calendar year', () => {
    expect(openableYear(at('2027-03-01T12:00:00Z'), 'UTC', [2027, 2028])).toBeNull();
  });

  it('ignores Years already past, which cannot be reopened', () => {
    expect(openableYear(at('2027-03-01T12:00:00Z'), 'UTC', [2025, 2026])).toBe(2027);
  });

  it('resolves the current year in the Family timezone, not UTC (§8.3 T3)', () => {
    // 1 January 00:30 UTC is still 31 December in New York.
    expect(openableYear(at('2028-01-01T00:30:00Z'), 'America/New_York', [])).toBe(2027);
    expect(openableYear(at('2028-01-01T00:30:00Z'), 'UTC', [])).toBe(2028);
  });
});

describe('setupDeadline (§5.2)', () => {
  it('ends at 1 January in the Family timezone', () => {
    const deadline = setupDeadline({
      openedAt: at('2027-10-01T12:00:00Z'),
      calendarYear: 2028,
      timezone: 'America/New_York',
    });
    expect(deadline.toISOString()).toBe('2028-01-01T05:00:00.000Z');
  });

  it('gives seven days when opened later than that', () => {
    const openedAt = at('2027-12-30T12:00:00Z');
    const deadline = setupDeadline({ openedAt, calendarYear: 2028, timezone: 'UTC' });
    expect(daysUntilSeal(openedAt, deadline)).toBe(7);
  });
});

describe('daysUntilSeal counts calendar days, not 24-hour blocks', () => {
  it('is seven sleeps from an afternoon, not six', () => {
    // The arithmetic version divided wall-clock instants and answered 6.
    expect(daysUntilSeal(at('2027-12-25T14:00:00Z'), at('2028-01-01T00:00:00Z'), 'UTC')).toBe(7);
  });

  it('survives a DST transition inside the window', () => {
    // Santiago springs forward in September; a 24-hour-block count loses a day.
    const days = daysUntilSeal(
      at('2027-09-01T12:00:00Z'),
      at('2027-09-11T12:00:00Z'),
      'America/Santiago',
    );
    expect(days).toBe(10);
  });
});

describe('sealCopy (§4.5 — factual, never conditional)', () => {
  it('counts plain days', () => {
    expect(sealCopy(at('2027-12-25T00:00:00Z'), at('2028-01-01T00:00:00Z'))).toBe(
      'the board seals in 7 days',
    );
  });

  it('says tomorrow and today rather than 1 and 0', () => {
    expect(sealCopy(at('2027-12-31T00:00:00Z'), at('2028-01-01T00:00:00Z'))).toBe(
      'the board seals tomorrow',
    );
    // Earlier the same day, not the deadline instant itself — at the instant it has sealed.
    expect(sealCopy(at('2028-01-01T09:00:00Z'), at('2028-01-01T23:00:00Z'))).toBe(
      'the board seals today',
    );
  });

  it('says the board has sealed once it has, rather than "today" forever', () => {
    expect(sealCopy(at('2028-02-01T00:00:00Z'), at('2028-01-01T00:00:00Z'))).toBe(
      'the board has sealed',
    );
  });

  it('never urges', () => {
    for (const now of ['2027-12-01', '2027-12-31', '2028-01-01', '2028-02-01']) {
      const copy = sealCopy(at(`${now}T00:00:00Z`), at('2028-01-01T00:00:00Z'));
      expect(copy).not.toMatch(/hurry|last chance|don.t miss|!/i);
    }
  });
});

describe('relevantYear — the Year it actually is', () => {
  const y = (calendar_year: number, status = 'setup') => ({ calendar_year, status });
  // The list arrives newest-first from useYears, which is exactly the ordering that
  // caused the bug: taking the first match meant taking the latest Year.
  const newestFirst = [y(2027), y(2026)];

  it('picks the Year the calendar is in, not the newest row', () => {
    // The reported bug: 2026 and 2027 both in setup, screen said 2027.
    expect(relevantYear(at('2026-08-03T23:50:00Z'), 'UTC', newestFirst)).toEqual(y(2026));
  });

  it('is unmoved by the order it is given', () => {
    expect(relevantYear(at('2026-08-03T23:50:00Z'), 'UTC', [y(2026), y(2027)])).toEqual(y(2026));
  });

  it('ignores status — a sealed Year that is this Year is still this Year', () => {
    const years = [y(2027, 'setup'), y(2026, 'active')];
    expect(relevantYear(at('2026-08-03T12:00:00Z'), 'UTC', years)).toEqual(y(2026, 'active'));
  });

  it('resolves the year where the Family lives, not where the server is (§8.3 T1)', () => {
    // 00:30 UTC on 1 January 2027 is still 2026 in New York.
    const years = [y(2027), y(2026)];
    expect(relevantYear(at('2027-01-01T00:30:00Z'), 'America/New_York', years))
      .toEqual(y(2026));
    expect(relevantYear(at('2027-01-01T00:30:00Z'), 'UTC', years)).toEqual(y(2027));
  });

  it('falls back to the most recent past Year when this one was never opened', () => {
    expect(relevantYear(at('2028-02-01T12:00:00Z'), 'UTC', [y(2026), y(2025)]))
      .toEqual(y(2026));
  });

  it('falls back to the nearest future Year when nothing has happened yet', () => {
    expect(relevantYear(at('2026-08-03T12:00:00Z'), 'UTC', [y(2029), y(2027)]))
      .toEqual(y(2027));
  });

  it('prefers an exact match over either fallback', () => {
    const years = [y(2028), y(2026), y(2024)];
    expect(relevantYear(at('2026-06-01T12:00:00Z'), 'UTC', years)).toEqual(y(2026));
  });

  it('returns undefined for a Family with no Years at all', () => {
    expect(relevantYear(at('2026-08-03T12:00:00Z'), 'UTC', [])).toBeUndefined();
  });
});

describe('hasOpenSetupWindow (§5.1)', () => {
  it('is true while any Year is still being authored', () => {
    expect(hasOpenSetupWindow([{ status: 'setup' }])).toBe(true);
    expect(hasOpenSetupWindow([{ status: 'active' }, { status: 'setup' }])).toBe(true);
  });

  it('goes false once the Setup Window seals, which is the December case', () => {
    // 2026 active, nothing in setup: opening 2027 for authoring is exactly right.
    expect(hasOpenSetupWindow([{ status: 'active' }, { status: 'frozen' }])).toBe(false);
  });

  it('is false for a Family with no Years', () => {
    expect(hasOpenSetupWindow([])).toBe(false);
  });
});

describe('playHasOpened (§22.5)', () => {
  const newYear = at('2027-01-01T05:00:00Z'); // 1 January in New York.

  it('is false while the Boards are sealed and the Year has not started', () => {
    // The whole point of the slice: a Family who finish in December seal in December.
    expect(playHasOpened(at('2026-12-20T12:00:00Z'), newYear)).toBe(false);
  });

  it('is true at the very instant the Year begins', () => {
    expect(playHasOpened(newYear, newYear)).toBe(true);
  });

  it('is true once the Year is under way', () => {
    expect(playHasOpened(at('2027-03-01T12:00:00Z'), newYear)).toBe(true);
  });

  /**
   * A Year opened inside its own calendar year — the March Family from `openableYear` —
   * has this instant in the past from the moment it exists, so play opens the moment the
   * Boards seal and nothing waits on anything.
   */
  it('is already true for a Year opened during itself', () => {
    expect(playHasOpened(at('2027-03-01T12:00:00Z'), at('2027-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('playOpensCopy (§4.5)', () => {
  const newYear = at('2028-01-01T00:00:00Z');

  it('says nothing once the Year is under way', () => {
    expect(playOpensCopy(at('2028-03-01T12:00:00Z'), newYear)).toBeNull();
  });

  it('counts sleeps, not 24-hour blocks', () => {
    expect(playOpensCopy(at('2027-12-25T14:00:00Z'), newYear)).toBe('play opens in 7 days');
  });

  it('reads as tomorrow the day before', () => {
    expect(playOpensCopy(at('2027-12-31T09:00:00Z'), newYear)).toBe('play opens tomorrow');
  });

  it('reads as today on the day itself', () => {
    // Midnight has not struck in this Family's zone, but the date has changed.
    expect(playOpensCopy(at('2028-01-01T00:00:00Z'), at('2028-01-01T05:00:00Z'))).toBe(
      'play opens today',
    );
  });

  it('never urges', () => {
    for (const now of ['2027-12-01', '2027-12-28', '2027-12-31']) {
      const copy = playOpensCopy(at(`${now}T00:00:00Z`), newYear);
      expect(copy).not.toMatch(/hurry|last chance|don.t miss|!/i);
    }
  });
});
