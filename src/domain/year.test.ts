import { describe, expect, it } from 'vitest';
import { daysUntilSeal, openableYear, sealCopy, setupDeadline } from './year';

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
