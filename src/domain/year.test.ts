import { describe, expect, it } from 'vitest';
import { daysUntilSeal, openableYear, sealCopy, setupDeadline } from './year';

const at = (iso: string) => new Date(iso);

describe('openableYear (§5.1)', () => {
  it('is next year, because the window ends on 1 January', () => {
    expect(openableYear(at('2027-06-01T12:00:00Z'), 'UTC')).toBe(2028);
  });

  it('resolves the current year in the Family timezone, not UTC (§8.3 T3)', () => {
    // 1 January 00:30 UTC is still 31 December in New York.
    expect(openableYear(at('2028-01-01T00:30:00Z'), 'America/New_York')).toBe(2028);
    expect(openableYear(at('2028-01-01T00:30:00Z'), 'UTC')).toBe(2029);
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
    expect(sealCopy(at('2028-01-01T00:00:00Z'), at('2028-01-01T00:00:00Z'))).toBe(
      'the board seals today',
    );
  });

  it('never goes negative or urges', () => {
    const copy = sealCopy(at('2028-02-01T00:00:00Z'), at('2028-01-01T00:00:00Z'));
    expect(copy).toBe('the board seals today');
    expect(copy).not.toMatch(/hurry|last chance|only|!/i);
  });
});
