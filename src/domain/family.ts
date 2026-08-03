/**
 * What makes a Family name acceptable (PRD §2.3).
 *
 * Pure, and in `src/domain` rather than beside the query that uses it, for the reason
 * every other rule in this directory is: it is shared. The database enforces the same
 * bounds in `create_family()`, the client checks them before spending a round trip, and
 * both have to agree. A rule that lives next to its caller ends up with two versions.
 */

/** 1 to 60 characters, and no uniqueness — two unrelated Smith Families are fine. */
export const FAMILY_NAME = { min: 1, max: 60 } as const;

/**
 * What is wrong with this name, in words a Member can act on, or `null` if nothing is.
 *
 * Says what to do rather than what went wrong (§0.3, and the copy voice in §4): "Give it
 * a name first", not "Name is required".
 */
export const familyNameProblem = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed.length < FAMILY_NAME.min) return 'Give it a name first.';
  if (trimmed.length > FAMILY_NAME.max) {
    return `That is longer than ${FAMILY_NAME.max} characters.`;
  }
  return null;
};
