import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, codeProblem, normalizeCode } from './invitation';

describe('the code alphabet (§4.5)', () => {
  it('drops the four characters that get misheard across a room', () => {
    for (const c of ['O', '0', 'I', '1']) expect(CODE_ALPHABET).not.toContain(c);
  });

  it('is 32 symbols, so the server can take a byte modulo it without bias', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
  });

  it('matches the alphabet generate_invitation_code() uses', () => {
    // Two copies of a constant only stay equal if something says so. The server's lives in
    // 20260801000010_invitations.sql; this is the assertion that ties them.
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(CODE_LENGTH).toBe(8);
  });
});

describe('normalizeCode', () => {
  it('upper-cases, because the server hashes the upper-cased form', () => {
    expect(normalizeCode('abcd2345')).toBe('ABCD2345');
  });

  it('forgives the ways people write a code down', () => {
    expect(normalizeCode('ABCD-2345')).toBe('ABCD2345');
    expect(normalizeCode(' ABCD 2345 ')).toBe('ABCD2345');
  });
});

describe('codeProblem', () => {
  it('accepts a well-formed code', () => {
    expect(codeProblem('ABCD2345')).toBeNull();
    expect(codeProblem('abcd-2345')).toBeNull();
  });

  it('asks for one when there is nothing', () => {
    expect(codeProblem('')).toBe('Paste or type the code you were sent.');
  });

  it('says how long a code is rather than that this one is wrong', () => {
    expect(codeProblem('ABCD')).toBe('A code is 8 characters.');
  });

  it('says the four excluded characters cannot appear, and offers no substitute', () => {
    // Both halves of each confusable pair are excluded, so "try 0 instead" would be
    // rejected on the next keystroke. Re-read, do not re-guess.
    const expected = 'Codes never contain O, 0, I or 1 — take another look at that character.';
    for (const c of ['O', '0', 'I', '1']) {
      expect(codeProblem(`ABCD234${c}`)).toBe(expected);
    }
  });

  it('is plain about a character that is simply not in a code', () => {
    expect(codeProblem('ABC$2345')).toBe('$ isn’t part of a code.');
  });

  it('never suggests a character the alphabet does not contain', () => {
    for (const c of [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
      const problem = codeProblem(`ABCD234${c}`);
      if (problem === null) continue;
      const suggested = /try (.) instead/.exec(problem)?.[1];
      if (suggested !== undefined) expect(CODE_ALPHABET).toContain(suggested);
    }
  });
});
