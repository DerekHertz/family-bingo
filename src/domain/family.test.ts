import { describe, expect, it } from 'vitest';
import { FAMILY_NAME, familyNameProblem } from './family';

describe('familyNameProblem (§2.3)', () => {
  it('accepts an ordinary name', () => {
    expect(familyNameProblem('Smith Family')).toBeNull();
  });

  it('rejects nothing at all, and whitespace that amounts to nothing', () => {
    expect(familyNameProblem('')).not.toBeNull();
    expect(familyNameProblem('   ')).not.toBeNull();
  });

  it('accepts a single character, because §2.3 sets the floor at one', () => {
    expect(familyNameProblem('H')).toBeNull();
  });

  it('measures the trimmed name, so trailing spaces cannot push it over', () => {
    expect(familyNameProblem(`${'x'.repeat(FAMILY_NAME.max)}   `)).toBeNull();
    expect(familyNameProblem('x'.repeat(FAMILY_NAME.max + 1))).not.toBeNull();
  });

  it('says what to do rather than what went wrong', () => {
    // §0.3 and the copy voice in §4: never coachy, never a validation lecture.
    expect(familyNameProblem('')).toBe('Give it a name first.');
  });
});
