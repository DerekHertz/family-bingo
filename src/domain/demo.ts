/**
 * The public demo, as the one fact three unrelated pieces of code have to agree on.
 *
 * The app is deployed publicly and sign-up is invite-only (`20260801000037`), so a stranger
 * cannot make an Account. The demo is the answer to what they see instead: one shared
 * Account, seeded into one Family whose Year is frozen, and therefore read-only by §20.1
 * rather than by anything written for the occasion.
 *
 * Three places need this address and none of them can ask the others for it:
 *
 *   - `supabase/functions/demo-login/index.ts` mints a session for it, and for nothing else.
 *   - `scripts/seed-demo-family.mjs` creates the Account and the Family under it.
 *   - `components/DemoBanner.tsx` decides whether the marker is on screen, by comparing the
 *     signed-in Account's address to this one.
 *
 * A constant copied into three files is a constant that eventually differs in one of them —
 * and the failure mode here is the worst kind: the marker stops rendering, so the demo goes
 * on working and simply stops saying that it is one.
 *
 * It lives in `src/domain` because that is the layer with no I/O, importable from the
 * client, from a Deno Edge Function and from a Node script alike (HANDOFF, "Architecture").
 * It is a fact about the product, not about any transport.
 */

/**
 * The address of the single shared demo Account.
 *
 * `family-bingo.pages.dev` is the deployment's own domain: a real name, resolvable, with no
 * mail server behind it and no way for anyone to hold a Google identity under it. An
 * address at `example.com` would have been the obvious choice and is the wrong one — it is
 * a domain somebody else owns, and this address is on `signup_allowlist`, which is the list
 * of addresses permitted to create an Account here.
 *
 * Compared case-insensitively wherever it is compared: GoTrue lowercases what it stores,
 * but nothing guarantees a provider hands the same casing back.
 */
export const DEMO_ACCOUNT_EMAIL = 'demo@family-bingo.pages.dev';

/** Whether a signed-in Account is the shared demo one. `undefined` is not (nobody is). */
export const isDemoAccount = (email: string | null | undefined): boolean =>
  typeof email === 'string' && email.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
