import { describe, expect, it } from 'vitest';
import { isControlledBy, isManaged } from './member';

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
