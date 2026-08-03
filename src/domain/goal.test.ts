import { describe, expect, it } from 'vitest';
import {
  AUTHORABLE_TILES,
  CENTER_POSITION,
  GOAL_TEXT,
  UNIT_MAX,
  draftProgress,
  goalTextProblem,
  incrementVerb,
  remainingCopy,
  stepperHint,
  targetProblem,
  targetSummary,
  unitProblem,
} from './goal';

describe('goalTextProblem (§6.1)', () => {
  it('accepts an ordinary goal', () => {
    expect(goalTextProblem('Read more books')).toBeNull();
  });

  it('asks for words rather than reporting a missing field', () => {
    expect(goalTextProblem('')).toBe('Write the goal first.');
    expect(goalTextProblem('   ')).toBe('Write the goal first.');
  });

  it('measures the trimmed text, not what was typed', () => {
    expect(goalTextProblem(`  ${'a'.repeat(GOAL_TEXT.max)}  `)).toBeNull();
    expect(goalTextProblem('a'.repeat(GOAL_TEXT.max + 1))).not.toBeNull();
  });

  it('accepts a goal the sharpener must handle gracefully (§7.6)', () => {
    // "Be a better father" is the canonical hard case, and it is a valid Goal exactly as
    // written. Nothing in authoring may reject it — that is §7.5's whole point.
    expect(goalTextProblem('Be a better father')).toBeNull();
  });
});

describe('unitProblem (§6.1)', () => {
  it('accepts nothing at all — the unit is optional', () => {
    expect(unitProblem('')).toBeNull();
  });

  it('accepts the Member’s own wording without correcting it', () => {
    expect(unitProblem('cups of tea')).toBeNull();
    expect(unitProblem('Books')).toBeNull();
  });

  it('stops at the column width', () => {
    expect(unitProblem('u'.repeat(UNIT_MAX))).toBeNull();
    expect(unitProblem('u'.repeat(UNIT_MAX + 1))).not.toBeNull();
  });
});

describe('targetProblem (§6.1, §6.2)', () => {
  it('accepts one — the one-shot shape is a target, not a type', () => {
    expect(targetProblem(1)).toBeNull();
  });

  it('accepts a large cumulative target', () => {
    expect(targetProblem(365)).toBeNull();
  });

  it('refuses zero and below', () => {
    expect(targetProblem(0)).toBe('A target is at least one.');
    expect(targetProblem(-3)).toBe('A target is at least one.');
  });

  it('refuses a fraction and a NaN', () => {
    expect(targetProblem(2.5)).toBe('A target is a whole number.');
    expect(targetProblem(Number.NaN)).toBe('A target is a whole number.');
  });
});

describe('incrementVerb (§4.1, §11.1)', () => {
  it('says the whole event for a one-shot Goal', () => {
    expect(incrementVerb(1)).toBe('Did it');
  });

  it('counts for everything else', () => {
    expect(incrementVerb(2)).toBe('+1');
    expect(incrementVerb(144)).toBe('+1');
  });
});

describe('targetSummary', () => {
  it('reads a one-shot Goal as an occasion', () => {
    expect(targetSummary(1)).toBe('once');
  });

  it('falls back to times when no unit was given', () => {
    expect(targetSummary(12)).toBe('12 times');
  });

  it('uses the Member’s word when there is one', () => {
    expect(targetSummary(12, 'books')).toBe('12 books');
    expect(targetSummary(1, 'marathon')).toBe('1 marathon');
  });

  it('never pluralises — the Member chose the word', () => {
    expect(targetSummary(12, 'book')).toBe('12 book');
    expect(targetSummary(3, 'cups of tea')).toBe('3 cups of tea');
  });

  it('treats an empty or blank unit as no unit', () => {
    expect(targetSummary(1, '')).toBe('once');
    expect(targetSummary(5, '   ')).toBe('5 times');
  });
});

describe('stepperHint (§4.1)', () => {
  it('previews the verb beside the target', () => {
    expect(stepperHint(1)).toBe('once · the button will say “Did it”');
    expect(stepperHint(300, 'walks')).toBe('300 walks · the button will say “+1”');
  });
});

describe('draftProgress and remainingCopy (§4.1, §10.2)', () => {
  it('counts against the 24 authorable Tiles, not 25', () => {
    // Position 12 is the Centre and belongs to the Family (§6.5).
    expect(AUTHORABLE_TILES).toBe(24);
    expect(CENTER_POSITION).toBe(12);
    expect(draftProgress(17)).toBe('17 of 24');
  });

  it('states what is left as a fact, never as an instruction', () => {
    expect(remainingCopy(0)).toBe('24 still empty.');
    expect(remainingCopy(23)).toBe('1 still empty.');
    expect(remainingCopy(24)).toBe('All 24 written.');
  });

  it('does not go negative if a Board somehow holds more', () => {
    expect(remainingCopy(25)).toBe('All 24 written.');
  });

  it('never says anything that could read as a pace (§0.3)', () => {
    for (let written = 0; written <= AUTHORABLE_TILES; written += 1) {
      const copy = `${draftProgress(written)} ${remainingCopy(written)}`;
      expect(copy).not.toMatch(/behind|hurry|only|just|left to go|should/i);
    }
  });
});
