import { describe, expect, it } from 'vitest';
import { failedWith, failure } from './failure';

describe('failure — the shape PostgREST actually throws', () => {
  /**
   * Not an Error. `@supabase/postgrest-js` rejects with `JSON.parse(body)`, so what
   * arrives in an `onError` handler is a plain object literal. Every `e instanceof Error`
   * check in this app read `''` because of it.
   */
  const postgrest = {
    code: 'PT409',
    details: null,
    hint: null,
    message: 'a Member may put forward at most 3 Proposals',
  };

  it('reads a plain PostgREST object', () => {
    expect(postgrest).not.toBeInstanceOf(Error);
    expect(failure(postgrest)).toEqual({
      message: 'a Member may put forward at most 3 Proposals',
      code: 'PT409',
    });
  });

  it('reads a real Error, whose message lives on the prototype', () => {
    expect(failure(new Error('network request failed'))).toEqual({
      message: 'network request failed',
      code: '',
    });
  });

  it('never throws, whatever it is handed', () => {
    for (const thrown of [null, undefined, 42, [], {}, 'a string', new Date(0)]) {
      expect(() => failure(thrown)).not.toThrow();
      expect(typeof failure(thrown).message).toBe('string');
      expect(typeof failure(thrown).code).toBe('string');
    }
  });

  it('takes a bare string as its own message', () => {
    expect(failure('nope').message).toBe('nope');
  });

  it('ignores a non-string message or code rather than coercing one', () => {
    expect(failure({ message: { nested: true }, code: 500 })).toEqual({ message: '', code: '' });
  });
});

describe('failedWith', () => {
  const sealed = { code: 'PT403', message: 'this Board is sealed — changing a Goal now costs a Swap' };

  it('matches on the SQLSTATE, which is where the code actually lives', () => {
    // The code is never inside the message text, so the old /PT403/ message regexes
    // could not have matched even once.
    expect(sealed.message).not.toContain('PT403');
    expect(failedWith(sealed, 'PT403')).toBe(true);
  });

  it('falls back to the message when the code is absent', () => {
    expect(failedWith({ message: 'this Board is sealed' }, 'PT403', /sealed/i)).toBe(true);
  });

  it('is false when neither matches', () => {
    expect(failedWith(sealed, 'PT409', /proposal/i)).toBe(false);
  });

  it('does not match a pattern against a code it was not given', () => {
    expect(failedWith({ code: 'PT409', message: '' }, 'PT403', /sealed/i)).toBe(false);
  });
});
