import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNT_EMAIL, isDemoAccount } from './demo';

describe('the demo Account', () => {
  it('is one address, on a domain nobody else can hold', () => {
    // Pinned rather than merely read back: this string is duplicated by construction into
    // an Edge Function and a seed script, and the failure mode of a drift is silent — the
    // marker stops rendering and the demo goes on working without saying it is one.
    expect(DEMO_ACCOUNT_EMAIL).toBe('demo@family-bingo.pages.dev');
  });

  it('recognises its own address', () => {
    expect(isDemoAccount(DEMO_ACCOUNT_EMAIL)).toBe(true);
  });

  it('recognises it whatever casing or padding a provider hands back', () => {
    expect(isDemoAccount('  Demo@Family-Bingo.Pages.Dev ')).toBe(true);
  });

  it('is nobody else', () => {
    expect(isDemoAccount('derekhertz@gmail.com')).toBe(false);
    // The near miss that a `startsWith` or a `includes` would wave through.
    expect(isDemoAccount('demo@family-bingo.pages.dev.example.com')).toBe(false);
  });

  it('is not an absent address', () => {
    // `session.user.email` is optional on the type and is genuinely absent for an identity
    // a provider returned without one. Absent means "not the demo", never "unknown".
    expect(isDemoAccount(undefined)).toBe(false);
    expect(isDemoAccount(null)).toBe(false);
    expect(isDemoAccount('')).toBe(false);
  });
});
