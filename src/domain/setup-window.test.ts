import { describe, expect, it } from 'vitest';
import {
  MINIMUM_SETUP_WINDOW_DAYS,
  freezeInstant,
  lateJoinerDeadline,
  remainingYearFraction,
  setupDeadline,
  startOfYearInZone,
} from './setup-window';

const at = (iso: string) => new Date(iso);

describe('startOfYearInZone (§8.3 T1–T3)', () => {
  it('resolves midnight on 1 January in the Family timezone, stored as UTC', () => {
    // New York is UTC-5 in January.
    expect(startOfYearInZone(2027, 'America/New_York').toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
  });

  it('handles a zone ahead of UTC', () => {
    // Tokyo is UTC+9 year-round.
    expect(startOfYearInZone(2027, 'Asia/Tokyo').toISOString()).toBe(
      '2026-12-31T15:00:00.000Z',
    );
  });

  it('handles a southern-hemisphere zone on summer time in January', () => {
    // Sydney is UTC+11 in January (AEDT).
    expect(startOfYearInZone(2027, 'Australia/Sydney').toISOString()).toBe(
      '2026-12-31T13:00:00.000Z',
    );
  });

  it('handles a half-hour offset', () => {
    expect(startOfYearInZone(2027, 'Asia/Kolkata').toISOString()).toBe(
      '2026-12-31T18:30:00.000Z',
    );
  });

  it('is UTC itself for UTC', () => {
    expect(startOfYearInZone(2027, 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('setupDeadline (§5.2)', () => {
  it('ends the Setup Window at 1 January in the Family timezone', () => {
    const deadline = setupDeadline({
      openedAt: at('2026-12-01T12:00:00Z'),
      calendarYear: 2027,
      timezone: 'America/New_York',
    });
    expect(deadline.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('guarantees a minimum window of 7 days when opened late (§5.2)', () => {
    // Opened on 30 December — 1 January is only two days away.
    const deadline = setupDeadline({
      openedAt: at('2026-12-30T09:00:00Z'),
      calendarYear: 2027,
      timezone: 'UTC',
    });
    expect(deadline.toISOString()).toBe('2027-01-06T09:00:00.000Z');
  });

  it('guarantees the minimum window when the Year is opened after it has begun', () => {
    const deadline = setupDeadline({
      openedAt: at('2027-03-15T09:00:00Z'),
      calendarYear: 2027,
      timezone: 'UTC',
    });
    expect(deadline.toISOString()).toBe('2027-03-22T09:00:00.000Z');
  });

  it('uses 1 January when it is exactly 7 days out', () => {
    const deadline = setupDeadline({
      openedAt: at('2026-12-25T00:00:00Z'),
      calendarYear: 2027,
      timezone: 'UTC',
    });
    expect(deadline.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('never returns a deadline less than 7 days out, across a year of opening dates', () => {
    for (let day = 1; day <= 365; day++) {
      const openedAt = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000);
      const deadline = setupDeadline({ openedAt, calendarYear: 2027, timezone: 'UTC' });
      const days = (deadline.getTime() - openedAt.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(MINIMUM_SETUP_WINDOW_DAYS);
    }
  });
});

describe('lateJoinerDeadline (§21.1)', () => {
  it('gives a Member approved mid-Year a personal 7-day Setup Window', () => {
    expect(lateJoinerDeadline(at('2027-07-14T10:30:00Z')).toISOString()).toBe(
      '2027-07-21T10:30:00.000Z',
    );
  });
});

describe('remainingYearFraction (§7.7, §21.3)', () => {
  it('is 1 at the very start of the Year', () => {
    expect(
      remainingYearFraction(at('2027-01-01T00:00:00Z'), 2027, 'UTC'),
    ).toBeCloseTo(1, 5);
  });

  it('is 0 once the Year has ended', () => {
    expect(remainingYearFraction(at('2028-01-01T00:00:00Z'), 2027, 'UTC')).toBe(0);
    expect(remainingYearFraction(at('2029-06-01T00:00:00Z'), 2027, 'UTC')).toBe(0);
  });

  it('is 1 before the Year begins, so Setup Window targets are full-year', () => {
    expect(remainingYearFraction(at('2026-12-01T00:00:00Z'), 2027, 'UTC')).toBe(1);
  });

  it('is about half at the start of July', () => {
    const fraction = remainingYearFraction(at('2027-07-02T12:00:00Z'), 2027, 'UTC');
    expect(fraction).toBeGreaterThan(0.49);
    expect(fraction).toBeLessThan(0.51);
  });

  it('scales a Sharpening target proportionately for a July joiner (§7.7)', () => {
    // "≈70 walks, not 300" — the spec's own worked example.
    const fraction = remainingYearFraction(at('2027-07-14T00:00:00Z'), 2027, 'UTC');
    expect(Math.round(300 * fraction)).toBeGreaterThan(130);
    expect(Math.round(300 * fraction)).toBeLessThan(150);
  });

  it('accounts for a leap year', () => {
    expect(remainingYearFraction(at('2028-01-01T00:00:00Z'), 2028, 'UTC')).toBeCloseTo(1, 5);
    // 2028 is a leap year: 366 days.
    const oneDayIn = remainingYearFraction(at('2028-01-02T00:00:00Z'), 2028, 'UTC');
    expect(oneDayIn).toBeCloseTo(365 / 366, 5);
  });

  it('never leaves the 0..1 range', () => {
    for (let day = -400; day <= 800; day += 7) {
      const now = new Date(Date.UTC(2027, 0, 1) + day * 86_400_000);
      const fraction = remainingYearFraction(now, 2027, 'UTC');
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('freezeInstant (§20.1)', () => {
  it('freezes the moment 31 December ends in the Family timezone', () => {
    expect(freezeInstant(2027, 'America/New_York').toISOString()).toBe(
      '2028-01-01T05:00:00.000Z',
    );
  });

  it('freezes a Tokyo Family 14 hours before a New York one', () => {
    const tokyo = freezeInstant(2027, 'Asia/Tokyo').getTime();
    const newYork = freezeInstant(2027, 'America/New_York').getTime();
    expect((newYork - tokyo) / 3_600_000).toBe(14);
  });

  it('is the start of the following Year', () => {
    expect(freezeInstant(2027, 'UTC').toISOString()).toBe(
      startOfYearInZone(2028, 'UTC').toISOString(),
    );
  });
});
