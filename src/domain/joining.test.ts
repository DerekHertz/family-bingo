import { describe, expect, it } from 'vitest';
import { joinedMarker, joinedMarkerInline, joinedMonth, lateJoinerNote } from './joining';

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

describe('joinedMarkerInline (§21.4)', () => {
  // The obvious `joinedMarker(...).toLowerCase()` downcases the month with the sentence,
  // and it was doing so at all four places the marker appears — so the capital was never
  // once seen in the product. Only the leading word is a common noun.
  it('lowercases the leading word and leaves the month alone', () => {
    expect(joinedMarkerInline('2026-07-14T12:00:00Z', 'UTC')).toBe('joined in July');
  });

  it('names the same month as the standalone marker, for every month', () => {
    for (let m = 1; m <= 12; m += 1) {
      const at = `2026-${String(m).padStart(2, '0')}-15T12:00:00Z`;
      expect(joinedMarkerInline(at, 'UTC')).toContain(joinedMonth(at, 'UTC'));
      expect(joinedMarker(at, 'UTC')).toContain(joinedMonth(at, 'UTC'));
    }
  });
});

describe('lateJoinerNote (§21.1, §21.2, §21.5, §0.3)', () => {
  it('explains that the deadline is their own', () => {
    expect(lateJoinerNote(false)).toContain('its own window');
  });

  // Migration 29 §8 clamps the window with `least(now() + 7 days, freeze_instant(...))`,
  // because a Member approved on 28 December would otherwise get one that outlived the
  // Year. So a late-December joiner has three days — and the meta line directly above this
  // card already says so. A card insisting on seven would be consecutive lines of the same
  // screen contradicting each other.
  it('never commits to a number of days, because the window is clamped', () => {
    for (const note of [lateJoinerNote(true), lateJoinerNote(false)]) {
      expect(note.toLowerCase()).not.toMatch(/seven|three|[0-9]/);
    }
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
