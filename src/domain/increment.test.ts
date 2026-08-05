import { describe, expect, it } from 'vitest';
import {
  RECENT_INCREMENTS,
  countCompact,
  countSummary,
  incrementVerb,
  occurredAtFor,
  stepperHint,
} from './increment';

describe('incrementVerb (§3, §4.1)', () => {
  it('says "Did it" when there is no unit', () => {
    expect(incrementVerb(null, null)).toBe('Did it');
  });

  it('uses the irregular verb §3 names for a walk', () => {
    expect(incrementVerb('walks', 'walk')).toBe('Walked one');
  });

  it('uses the irregular verb §3 names for a book', () => {
    expect(incrementVerb('Books', 'book')).toBe('Read one');
  });

  it('falls back to a phrasing that is plain but never wrong', () => {
    expect(incrementVerb('pomodoros', 'pomodoro')).toBe('Log one pomodoro');
  });

  it('prefers the canonical singular over the Member’s plural wording', () => {
    expect(incrementVerb('books', 'chapter')).toBe('Read one');
    expect(incrementVerb('widgets', 'widget')).toBe('Log one widget');
  });

  it('never puts the Member’s own wording after "one" — it is usually plural', () => {
    // "Log one runs" reads as a bug in the app rather than a gap in the copy. A Goal that
    // skipped Sharpening has no singular to use (§6.1a), so it says one *what* nowhere —
    // the ring beside the button already does.
    expect(incrementVerb('runs', null)).toBe('Log one');
    expect(incrementVerb('laps', null)).toBe('Log one');
    expect(incrementVerb('glasses of water', null)).toBe('Log one');
  });

  it('is not fooled by case or padding in either field', () => {
    expect(incrementVerb('  Walks ', '  WALK  ')).toBe('Walked one');
  });

  it('treats an empty-string unit as no unit at all', () => {
    expect(incrementVerb('', '')).toBe('Did it');
    expect(incrementVerb('   ', null)).toBe('Did it');
  });

  it('never returns an empty or whitespace-only label', () => {
    for (const unit of [null, '', ' ', 'x', 'books']) {
      for (const canonical of [null, '', ' ', 'book', 'unknown-thing']) {
        expect(incrementVerb(unit, canonical).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('stepperHint (§4.1)', () => {
  it('previews the verb beside the target', () => {
    expect(stepperHint(1, null)).toBe('once · the button will say “Did it”');
  });

  it('previews the SAME verb the tile sheet will show', () => {
    // The whole reason this lives beside `incrementVerb`. A second rule in goal.ts knew
    // only the target and answered "+1" for anything above one, so these two disagreed on
    // every Goal with a unit — promised while authoring, contradicted all Year.
    for (const [unit, canonical] of [
      ['walks', 'walk'],
      ['books', 'book'],
      ['pomodoros', 'pomodoro'],
      ['runs', null],
      [null, null],
    ] as const) {
      expect(stepperHint(12, unit, canonical)).toContain(
        `“${incrementVerb(unit, canonical)}”`,
      );
    }
  });

  it('reads the target through targetSummary, unit and all', () => {
    expect(stepperHint(300, 'walks', 'walk')).toBe(
      '300 walks · the button will say “Walked one”',
    );
  });

  it('is honest about a Goal that has not been sharpened yet', () => {
    // `unit_canonical` is Sharpening's (§7.10) and is NULL until it runs, so the preview
    // says "Log one" and the sheet will say "Read one" once the model answers. One rule
    // reading an incomplete Goal — not two rules disagreeing about a complete one.
    expect(stepperHint(12, 'books')).toBe('12 books · the button will say “Log one”');
  });
});

describe('countSummary', () => {
  it('reads as §3’s ring label', () => {
    expect(countSummary(3, 144)).toBe('3 of 144');
    expect(countSummary(0, 1)).toBe('0 of 1');
  });

  it('does not clamp overshoot — the ring stops at full, the count does not', () => {
    // §13.5 hides overshoot on the *board*; the sheet is where the real number lives.
    expect(countSummary(160, 150)).toBe('160 of 150');
  });
});

describe('countCompact', () => {
  it('reads as a column entry rather than a sentence', () => {
    expect(countCompact(3, 144)).toBe('3/144');
  });

  it('puts the numbers in the same order countSummary does', () => {
    // The sealed Board's goal list shows one and says the other in the same row's
    // accessibility label. A row reading "3/144" while announcing "144 of 3" is two apps.
    for (const [count, target] of [
      [0, 1],
      [3, 144],
      [160, 150],
    ] as const) {
      expect(countCompact(count, target)).toBe(
        countSummary(count, target).replace(' of ', '/'),
      );
    }
  });
});

describe('RECENT_INCREMENTS', () => {
  it('is the three §3 asks for', () => {
    expect(RECENT_INCREMENTS).toBe(3);
  });
});

/**
 * The clamp exists for one failure, and it is a bad one: `stamp_increment()` raises
 * `PT403` for anything below `least(sealed_at, now())`, `classifyDelivery` drops a `PT403`,
 * and so a handset whose clock has reset can log nothing at all for the rest of the Year —
 * online with an unhelpable message, offline by silently discarding at the next drain.
 */
describe('occurredAtFor — §17.3 without letting a clock end the game', () => {
  const SEALED = '2027-01-01T09:00:00.000Z';

  it('sends the device clock when the device clock is after the seal', () => {
    // The ordinary case, and §17.3's whole point: a tap held for three days still carries
    // the day it happened.
    expect(occurredAtFor('2027-03-04T10:00:00.000Z', SEALED)).toBe('2027-03-04T10:00:00.000Z');
  });

  it('clamps a clock that reads before the seal up to the seal', () => {
    // A handset reset to the factory date. Every tap would otherwise be PT403 and dropped.
    expect(occurredAtFor('1970-01-01T00:00:00.000Z', SEALED)).toBe(SEALED);
  });

  it('clamps a clock a few seconds behind, which is the common case on a fresh seal', () => {
    expect(occurredAtFor('2027-01-01T08:59:57.000Z', SEALED)).toBe(SEALED);
  });

  it('never answers earlier than the seal, for any clock', () => {
    for (const device of [
      '1970-01-01T00:00:00.000Z',
      '2026-12-31T23:59:59.999Z',
      '2027-01-01T08:59:59.999Z',
    ]) {
      expect(Date.parse(occurredAtFor(device, SEALED))).toBeGreaterThanOrEqual(Date.parse(SEALED));
    }
  });

  it('leaves a clock that runs fast alone, because the server pulls it back itself', () => {
    // `stamp_increment()` is asymmetric on purpose: a future value is benign and is pulled
    // back to now(). Clamping it here as well would be a second rule for one fact.
    const ahead = '2099-01-01T00:00:00.000Z';
    expect(occurredAtFor(ahead, SEALED)).toBe(ahead);
  });

  it('has nothing to clamp to on a Board that has not sealed', () => {
    // `tile_is_loggable()` refuses an Increment until `sealed_at is not null`, so there is
    // no bound and nothing to protect.
    expect(occurredAtFor('1970-01-01T00:00:00.000Z', null)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('leaves an unreadable timestamp alone rather than inventing one', () => {
    expect(occurredAtFor('not a date', SEALED)).toBe('not a date');
    expect(occurredAtFor('2027-03-04T10:00:00.000Z', 'not a date')).toBe(
      '2027-03-04T10:00:00.000Z',
    );
  });
});
