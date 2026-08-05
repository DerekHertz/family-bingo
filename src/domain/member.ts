/**
 * Who an Account may act as, and who has no login of their own (PRD §4, ADR-0003).
 *
 * Two predicates, and both of them were written out by hand at five call sites before
 * this file existed. They are here rather than beside any one query because they are the
 * client's half of a rule the **database** enforces, and the two have to be readably the
 * same shape.
 *
 * ## The SQL this mirrors
 *
 * `controlled_member_ids()`, from `supabase/migrations/20260801000011_managed_members.sql`
 * — declared in `20260801000005_rls.sql` and used by every write guard in the schema:
 *
 * ```sql
 * select id from members
 *  where status = 'active'
 *    and (account_id = auth.uid() or guardian_account_id = auth.uid());
 * ```
 *
 * **The SQL copy is the one RLS enforces.** `write_goal()`, `cast_ballot()`,
 * `complete_family_goal()` and the `sharpen` Edge Function all check it server-side, and
 * nothing a screen decides can loosen it. What `isControlledBy` is for is the other
 * direction: not showing a Member a control the server is going to refuse. So the two must
 * stay in step — a client copy that is *stricter* hides a legitimate action, and one that
 * is *looser* offers a button that answers 42501 with nothing on screen to explain it.
 * If the SQL changes, this changes with it.
 *
 * Pure, no imports, tested without a database (PRD §13.6).
 */

/**
 * The three columns the rule is made of. A structural type rather than a `Member`
 * interface, because these rows arrive from four different `select`s with four different
 * column lists and none of them is the whole table.
 */
export interface MemberAccount {
  /** The Account that logs in as this Member, or `null` for a Managed Member. */
  account_id: string | null;
}

export interface MemberBacking extends MemberAccount {
  /** The Account answerable for a Managed Member, or `null` for everyone else. */
  guardian_account_id: string | null;
}

export interface MemberStanding extends MemberBacking {
  /** `'pending'` until the Organizer lets them in (§3.3); `'active'` after. */
  status: string;
}

/**
 * May this Account act as this Member? Exactly `controlled_member_ids()`, above.
 *
 * `status = 'active'` is half the rule and is the half that gets dropped: a pending
 * Member is backed by the right Account and is still nobody's to write for until §3.3's
 * second gate opens.
 *
 * **The Account is required.** Passing `null` or `undefined` answers `false` rather than
 * matching, which is not pedantry — `useSession()` is `undefined` on its first render, and
 * a bare `member.account_id === accountId` would have made every Managed Member in the
 * Family (whose `account_id` IS null) controlled by nobody-in-particular for that frame.
 *
 * This is deliberately **not** Family-scoped, because the SQL is not either. Somebody in
 * two Families is two Members (CONTEXT.md) and both match `account_id`, so any caller
 * reducing a list of Members to "the ones I may act as" has to filter on `family_id`
 * first — see the note in `useCentre`, where getting it wrong voted as the wrong Member.
 */
export const isControlledBy = (
  member: MemberStanding,
  accountId: string | null | undefined,
): boolean =>
  accountId != null &&
  member.status === 'active' &&
  (member.account_id === accountId || member.guardian_account_id === accountId);

/**
 * Is this a Managed Member — a child who plays through a Guardian's Account (§4.4)?
 *
 * Read off `account_id`, and it was written both ways: `account_id === null` in the Board
 * and Centre queries, `guardian_account_id !== null` in the roster. They cannot disagree —
 * `member_has_exactly_one_backer` is a CHECK constraint, `num_nonnulls(account_id,
 * guardian_account_id) = 1`, so a Member is backed by exactly one of the two and never
 * both or neither. Two spellings of one fact is still two things to keep true, and only
 * one of them survives a `select` that forgot to ask for the other column.
 *
 * `account_id` is the one, because "has no login of their own" is what a Managed Member
 * *is* (§4.4) — the Guardian is who is accountable for it, which is a different sentence.
 * It is also the column the narrowest `select` in the app already asks for: a Ballot's
 * Member comes back as `(display_name, account_id)` and nothing more.
 */
export const isManaged = (member: MemberAccount): boolean => member.account_id === null;

/** One entry in §4.3's "Voting as" row. */
export interface Voter {
  id: string;
  name: string;
  isManaged: boolean;
}

/**
 * Who this Account may cast a Ballot as: themselves, plus every child they guard (§4.3).
 *
 * A projection rather than a query, which is the point. The Centre used to read `members`
 * a second time to answer this, one column apart from the roster's read of the same rows
 * into a second cache entry with a second shape. It is the roster's list, narrowed — and
 * because the narrowing is by Account it must be done **here, on the way out**, never
 * baked into a cache entry keyed by Family alone.
 *
 * Order is whatever order the caller supplied, which is join order (§7.2, §13.5) and is
 * the one ordering that says nothing about achievement. Pending Members drop out through
 * `isControlledBy`: a Member the Organizer has not let in yet has no vote (§3.3).
 *
 * **Scope the list to one Family before calling this.** `controlled_member_ids()` is not
 * Family-scoped and neither is this: somebody in two Families is two Members and both
 * match `account_id`, so an unscoped list would offer a chip for the wrong Family's Member
 * and `cast_ballot()` would refuse every Ballot cast with it.
 */
export const votersFor = <T extends MemberStanding & { id: string; display_name: string }>(
  members: readonly T[],
  accountId: string | null | undefined,
): Voter[] =>
  members
    .filter((member) => isControlledBy(member, accountId))
    .map((member) => ({
      id: member.id,
      name: member.display_name,
      isManaged: isManaged(member),
    }));
