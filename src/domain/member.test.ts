import { describe, expect, it } from 'vitest';
import { isControlledBy, isManaged, votersFor } from './member';

/** An adult: their own Account, no Guardian (`member_has_exactly_one_backer`). */
const adult = (accountId: string, status = 'active') => ({
  account_id: accountId,
  guardian_account_id: null,
  status,
});

/** A child: a Guardian, no Account of their own (§4.4). */
const child = (guardianId: string, status = 'active') => ({
  account_id: null,
  guardian_account_id: guardianId,
  status,
});

describe('isControlledBy — the client half of controlled_member_ids()', () => {
  it('lets an Account act as itself', () => {
    expect(isControlledBy(adult('acc-1'), 'acc-1')).toBe(true);
  });

  it('lets a Guardian act as the child they guard (§4.2)', () => {
    expect(isControlledBy(child('acc-1'), 'acc-1')).toBe(true);
  });

  it('refuses somebody else’s Member', () => {
    expect(isControlledBy(adult('acc-2'), 'acc-1')).toBe(false);
    expect(isControlledBy(child('acc-2'), 'acc-1')).toBe(false);
  });

  it('refuses a pending Member — the second gate is half the rule (§3.3)', () => {
    // Backed by the right Account and still nobody's to write for until the Organizer
    // lets them in. This is the half that gets dropped when the rule is written by hand.
    expect(isControlledBy(adult('acc-1', 'pending'), 'acc-1')).toBe(false);
    expect(isControlledBy(child('acc-1', 'pending'), 'acc-1')).toBe(false);
  });

  it('refuses a removed Member', () => {
    expect(isControlledBy(adult('acc-1', 'removed'), 'acc-1')).toBe(false);
  });

  it('answers false for no Account at all, rather than matching a null column', () => {
    // `useSession()` is `undefined` on its first render. A bare `account_id === accountId`
    // would make every Managed Member in the Family controlled for that frame, because
    // theirs IS null.
    expect(isControlledBy(child('acc-1'), undefined)).toBe(false);
    expect(isControlledBy(child('acc-1'), null)).toBe(false);
    expect(isControlledBy(adult('acc-1'), undefined)).toBe(false);
  });
});

describe('votersFor (§4.3)', () => {
  // One Family's roster, in join order — the shape `useRoster` returns.
  const roster = [
    { id: 'm-1', display_name: 'Ada', ...adult('acc-1') },
    { id: 'm-2', display_name: 'Bo', ...adult('acc-2') },
    { id: 'm-3', display_name: 'Cy', ...child('acc-1') },
    { id: 'm-4', display_name: 'Di', ...child('acc-2') },
    { id: 'm-5', display_name: 'Eve', ...adult('acc-1', 'pending') },
  ];

  it('gives a Guardian themselves and their children, and nobody else’s', () => {
    expect(votersFor(roster, 'acc-1')).toEqual([
      { id: 'm-1', name: 'Ada', isManaged: false },
      { id: 'm-3', name: 'Cy', isManaged: true },
    ]);
  });

  it('answers per Account from the same list — the roster is cached per Family', () => {
    // The narrowing is by Account and happens on the way out, never inside a cache entry
    // keyed by Family alone. Two Accounts, one roster, two answers.
    expect(votersFor(roster, 'acc-2').map((v) => v.id)).toEqual(['m-2', 'm-4']);
  });

  it('keeps the order it was given — join order, never a ranking (§7.2)', () => {
    expect(votersFor(roster, 'acc-1').map((v) => v.name)).toEqual(['Ada', 'Cy']);
  });

  it('leaves out a Member the Organizer has not let in yet (§3.3)', () => {
    expect(votersFor(roster, 'acc-1').map((v) => v.id)).not.toContain('m-5');
  });

  it('is empty with no session rather than everybody’s children', () => {
    expect(votersFor(roster, undefined)).toEqual([]);
  });
});

describe('isManaged', () => {
  it('is true for a child and false for an adult', () => {
    expect(isManaged(child('acc-1'))).toBe(true);
    expect(isManaged(adult('acc-1'))).toBe(false);
  });

  it('agrees with the guardian_account_id spelling it replaced', () => {
    // `member_has_exactly_one_backer` — num_nonnulls(account_id, guardian_account_id) = 1
    // — is what makes the two equivalent. Both spellings shipped; only one survives a
    // `select` that forgot the other column.
    for (const member of [adult('acc-1'), child('acc-2')]) {
      expect(isManaged(member)).toBe(member.guardian_account_id !== null);
    }
  });
});
