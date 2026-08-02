import { describe, expect, it } from 'vitest';
import {
  GOAL_CATEGORIES,
  SHARPEN_LIMIT_PER_YEAR,
  SHARPEN_MODEL,
  SHARPEN_OUTPUT_SCHEMA,
  SHARPEN_SYSTEM_PROMPT,
  buildSharpenUserMessage,
  normalizeSuggestions,
} from './sharpen';

describe('the model call (§7.2, §7.3, §7.4)', () => {
  it('uses claude-opus-5', () => {
    expect(SHARPEN_MODEL).toBe('claude-opus-5');
  });

  it('rate limits to 100 calls per Member per Year (§7.8)', () => {
    expect(SHARPEN_LIMIT_PER_YEAR).toBe(100);
  });

  it('asks for a schema that validates rather than prose (§7.3)', () => {
    const item = SHARPEN_OUTPUT_SCHEMA.properties.suggestions.items;
    expect([...item.required]).toEqual([
      'text',
      'target',
      'unit',
      'unit_canonical',
      'category',
      'pace_hint',
    ]);
    expect(item.additionalProperties).toBe(false);
  });

  it('constrains category to the same closed set the schema CHECK enforces', () => {
    expect([...SHARPEN_OUTPUT_SCHEMA.properties.suggestions.items.properties.category.enum])
      .toEqual([...GOAL_CATEGORIES]);
  });

  it('asks for a whole-number Target', () => {
    expect(SHARPEN_OUTPUT_SCHEMA.properties.suggestions.items.properties.target.type)
      .toBe('integer');
  });
});

describe('the system prompt', () => {
  it('is long enough to clear Opus 5\'s 512-token cacheable minimum (§7.4)', () => {
    // Opus 5 caches from 512 tokens; below that `cache_control` is silently a no-op and
    // every Sharpening call pays full price for the prompt. Roughly 4 characters per
    // token, so ~2048 characters is the floor with margin.
    expect(SHARPEN_SYSTEM_PROMPT.length).toBeGreaterThan(2600);
  });

  it('handles the canonical hard case by name (§7.6)', () => {
    // "Be a better father" is the case the PRD singles out. An app that refuses it, or
    // answers it clinically, is an app someone deletes.
    expect(SHARPEN_SYSTEM_PROMPT).toContain('Be a better father');
    expect(SHARPEN_SYSTEM_PROMPT).toContain('One-on-one outing with each kid');
  });

  it('forbids the failure modes §7.6 names — preachy, clinical, or implying inadequacy', () => {
    expect(SHARPEN_SYSTEM_PROMPT).toMatch(/never evaluate/i);
    expect(SHARPEN_SYSTEM_PROMPT).toMatch(/does not lecture/i);
    expect(SHARPEN_SYSTEM_PROMPT).toMatch(/not imply|does not imply/i);
  });

  it('tells the model to propose achievable targets, not perfect ones (§4.3, ADR-0002)', () => {
    // A target that becomes impossible in March leaves a dead square for nine months —
    // the exact failure ADR-0002 exists to prevent.
    expect(SHARPEN_SYSTEM_PROMPT).toContain('300');
    expect(SHARPEN_SYSTEM_PROMPT).toMatch(/not 365/i);
  });

  it('asks for unit_canonical and category in the same call (§7.10)', () => {
    expect(SHARPEN_SYSTEM_PROMPT).toContain('unit_canonical');
    expect(SHARPEN_SYSTEM_PROMPT).toContain('singular lowercase');
  });

  it('says pace is never used in a calculation (§6.3)', () => {
    expect(SHARPEN_SYSTEM_PROMPT).toMatch(/never used in any calculation/i);
  });

  it('asks for one suggestion, not a menu (FRONTEND_DESIGN §4.2)', () => {
    expect(SHARPEN_SYSTEM_PROMPT).toMatch(/single suggestion/i);
  });
});

describe('buildSharpenUserMessage (§7.7, §21.3)', () => {
  it('sends the goal alone for a full year', () => {
    expect(buildSharpenUserMessage({ text: 'take a walk every day', remainingYearFraction: 1 }))
      .toBe('Goal: take a walk every day');
  });

  it('tells the model to scale down for a late joiner', () => {
    const message = buildSharpenUserMessage({
      text: 'take a walk every day',
      remainingYearFraction: 0.46,
    });
    expect(message).toContain('Goal: take a walk every day');
    expect(message).toContain('46%');
    expect(message).toMatch(/scale the target/i);
  });

  it('trims the Member\'s text without altering it', () => {
    expect(buildSharpenUserMessage({ text: '  Be a better father  ', remainingYearFraction: 1 }))
      .toBe('Goal: Be a better father');
  });

  it('treats a nonsense fraction as a full year rather than failing', () => {
    expect(buildSharpenUserMessage({ text: 'Read', remainingYearFraction: NaN }))
      .toBe('Goal: Read');
    expect(buildSharpenUserMessage({ text: 'Read', remainingYearFraction: 5 }))
      .toBe('Goal: Read');
  });

  it('keeps the volatile half in the user turn, so the cached system prefix survives', () => {
    // The fraction changes per request; if it were in the system prompt every call
    // would miss the cache (§7.4).
    expect(SHARPEN_SYSTEM_PROMPT).not.toMatch(/\d+% of the year/);
  });
});

describe('normalizeSuggestions — never throws, degrades to empty (§7.9)', () => {
  const wellFormed = {
    suggestions: [
      {
        text: 'Walk',
        target: 300,
        unit: 'walks',
        unit_canonical: 'Walk',
        category: 'fitness',
        pace_hint: 'about six a week',
      },
    ],
  };

  it('reads a well-formed response', () => {
    expect(normalizeSuggestions(wellFormed)).toEqual([
      {
        text: 'Walk',
        target: 300,
        unit: 'walks',
        unitCanonical: 'walk',
        category: 'fitness',
        paceHint: 'about six a week',
      },
    ]);
  });

  it('lowercases unit_canonical so units group at year end (§7.10)', () => {
    const result = normalizeSuggestions({
      suggestions: [{ ...wellFormed.suggestions[0], unit: 'Books', unit_canonical: 'BOOK' }],
    });
    expect(result[0]?.unitCanonical).toBe('book');
    expect(result[0]?.unit).toBe('Books');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'sorry, I cannot help with that'],
    ['a number', 42],
    ['an empty object', {}],
    ['a missing array', { suggestions: 'nope' }],
    ['an empty array', { suggestions: [] }],
    ['an array of junk', { suggestions: [null, 3, 'x', []] }],
  ])('returns an empty list for %s', (_label, payload) => {
    expect(normalizeSuggestions(payload)).toEqual([]);
  });

  it('drops a suggestion with no usable text', () => {
    expect(normalizeSuggestions({ suggestions: [{ ...wellFormed.suggestions[0], text: '   ' }] }))
      .toEqual([]);
  });

  it('drops a Target below 1 — target = 1 IS the one-shot shape (§6.2)', () => {
    for (const target of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '12']) {
      expect(normalizeSuggestions({
        suggestions: [{ ...wellFormed.suggestions[0], target }],
      })).toEqual([]);
    }
  });

  it('accepts a Target of exactly 1', () => {
    const result = normalizeSuggestions({
      suggestions: [{ ...wellFormed.suggestions[0], text: 'Run a marathon', target: 1 }],
    });
    expect(result[0]?.target).toBe(1);
  });

  it('floors a fractional Target rather than discarding the suggestion', () => {
    const result = normalizeSuggestions({
      suggestions: [{ ...wellFormed.suggestions[0], target: 12.7 }],
    });
    expect(result[0]?.target).toBe(12);
  });

  it('nulls an unknown Category rather than failing the whole suggestion', () => {
    // The Goal still counts everywhere except aggregate Wrapped cards (§20.8), so a bad
    // category must never cost the Member their suggestion.
    const result = normalizeSuggestions({
      suggestions: [{ ...wellFormed.suggestions[0], category: 'vibes' }],
    });
    expect(result[0]?.category).toBeNull();
    expect(result[0]?.text).toBe('Walk');
  });

  it('nulls a missing unit and pace rather than failing', () => {
    const result = normalizeSuggestions({
      suggestions: [{ text: 'Run a marathon', target: 1 }],
    });
    expect(result[0]).toEqual({
      text: 'Run a marathon',
      target: 1,
      unit: null,
      unitCanonical: null,
      category: null,
      paceHint: null,
    });
  });

  it('truncates rather than rejecting an over-long field', () => {
    const result = normalizeSuggestions({
      suggestions: [{
        ...wellFormed.suggestions[0],
        text: 'x'.repeat(500),
        unit: 'y'.repeat(90),
      }],
    });
    expect(result[0]?.text).toHaveLength(200); // goals.text CHECK is 1..200
    expect(result[0]?.unit).toHaveLength(30); // goals.unit CHECK is <= 30
  });

  it('returns a single suggestion even if the model sends several', () => {
    expect(normalizeSuggestions({
      suggestions: [
        wellFormed.suggestions[0],
        { ...wellFormed.suggestions[0], text: 'Second' },
        { ...wellFormed.suggestions[0], text: 'Third' },
      ],
    })).toHaveLength(1);
  });
});
