/**
 * The Invitation code's shape, as the client sees it.
 *
 * The alphabet is the server's (20260801000010_invitations.sql) and the reason is
 * FRONTEND_DESIGN §4.5: the code gets read aloud across a room, so O, 0, I and 1 are gone.
 * Repeating it here is not duplication for its own sake — it is what lets the field
 * correct a mis-heard character before spending a round trip, and a test pins the two
 * copies together.
 */

/** No O, no 0, no I, no 1. Eight characters of 32 symbols. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/**
 * What someone typed, as the server would hash it: upper-cased and trimmed.
 *
 * Spaces and dashes come free — people write codes down in groups, and refusing
 * `ABCD-2345` because of a dash would be the software being difficult about its own
 * formatting.
 */
export const normalizeCode = (input: string): string =>
  input.toUpperCase().replace(/[\s-]/g, '');

/**
 * The four the alphabet deliberately omits.
 *
 * There is no "try 0 instead" to offer, and the first version of this offered it anyway:
 * BOTH halves of each confusable pair are excluded, so every suggestion it made would have
 * been rejected on the next keystroke. What is actually useful is saying the character
 * cannot appear at all, which tells someone to re-read rather than re-guess.
 */
const NEVER_IN_A_CODE = new Set(['O', '0', 'I', '1']);

export const codeProblem = (input: string): string | null => {
  const code = normalizeCode(input);
  if (code.length === 0) return 'Paste or type the code you were sent.';
  if (code.length !== CODE_LENGTH) return `A code is ${CODE_LENGTH} characters.`;

  const stray = [...code].find((c) => !CODE_ALPHABET.includes(c));
  if (stray !== undefined) {
    return NEVER_IN_A_CODE.has(stray)
      ? 'Codes never contain O, 0, I or 1 — take another look at that character.'
      : `${stray} isn’t part of a code.`;
  }
  return null;
};
