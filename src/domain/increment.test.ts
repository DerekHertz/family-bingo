import { describe, expect, it } from 'vitest';
import { RECENT_INCREMENTS, countSummary, incrementVerb, stepperHint } from './increment';

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

describe('RECENT_INCREMENTS', () => {
  it('is the three §3 asks for', () => {
    expect(RECENT_INCREMENTS).toBe(3);
  });
});
