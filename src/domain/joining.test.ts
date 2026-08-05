import { describe, expect, it } from 'vitest';
import { joinedMarker, joinedMonth, lateJoinerNote } from './joining';

describe('joinedMonth (§21.4, §8.3 T1)', () => {
  it('names the month a Member arrived', () => {
    expect(joinedMonth('2026-07-14T12:00:00Z', 'America/New_York')).toBe('July');
  });

  // The Family's calendar is one calendar. A Member approved at 11pm on 31 July in New
  // York joined in July, and a Guardian reading it from Berlin sees the same month the
  // rest of the Family does — which is the same rule §8.3 T1 applies to deadlines.
  it('resolves in the Family′s timezone, not the reader′s', () => {
    const lateOnTheLastOfJuly = '2026-08-01T03:00:00Z'; // 11pm on 31 July in New York
    expect(joinedMonth(lateOnTheLastOfJuly, 'America/New_York')).toBe('July');
    expect(joinedMonth(lateOnTheLastOfJuly, 'Europe/Berlin')).toBe('August');
  });

  it('answers for every month of the year', () => {
    const months = Array.from({ length: 12 }, (_, m) =>
      joinedMonth(`2026-${String(m + 1).padStart(2, '0')}-15T12:00:00Z`, 'UTC'),
    );
    expect(new Set(months).size).toBe(12);
  });
});

describe('joinedMarker (§21.4, §21.5)', () => {
  it('is §21.4′s own phrasing', () => {
    expect(joinedMarker('2026-07-14T12:00:00Z', 'UTC')).toBe('Joined in July');
  });

  // §21.5: there is no standing to be behind in, so there is nothing to count. "Joined in
  // July" is a fact about a date; "5 months late" is a judgment.
  it('states a date and never a shortfall', () => {
    const said = joinedMarker('2026-11-02T12:00:00Z', 'UTC');
    expect(said).not.toMatch(/\d/);
    expect(said.toLowerCase()).not.toMatch(/late|behind|missed|only|still|catch/);
  });
});

describe('lateJoinerNote (§21.1, §21.2, §21.5, §0.3)', () => {
  it('explains the deadline nobody else has', () => {
    expect(lateJoinerNote(false)).toContain('seven days');
  });

  // §21.2 — the Centre Vote is not reopened, so the middle square arrives filled in and
  // un-votable. Unexplained, that looks broken.
  it('explains the already-decided centre when there is one', () => {
    expect(lateJoinerNote(true).toLowerCase()).toContain('middle square');
  });

  it('says nothing about the centre when the Family voted for personal squares', () => {
    expect(lateJoinerNote(false).toLowerCase()).not.toContain('middle square');
  });

  // §0.3 — nothing scolds, and §21.5 — no proration. The note may not count anything, and
  // may not imply the Member has ground to make up.
  it('never counts, never compares, never reassures about being behind', () => {
    for (const note of [lateJoinerNote(true), lateJoinerNote(false)]) {
      expect(note).not.toMatch(/\d/);
      expect(note.toLowerCase()).not.toMatch(
        /behind|catch up|don’t worry|dont worry|still time|hurry|plenty of|everyone else has/,
      );
    }
  });
});
