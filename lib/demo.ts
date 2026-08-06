/**
 * Getting into the demo, and knowing when you are in it.
 *
 * Sign-up is invite-only (`20260801000037`), so a stranger cannot make an Account — which
 * leaves the demo as the only way anyone but a family member sees the product. This is the
 * client half of `supabase/functions/demo-login/index.ts`.
 *
 * It is a separate module from `lib/auth.ts` on purpose. `signInWithoutEmail` is a **back
 * door**: it takes an address and a secret and can produce a session for any Account on the
 * project, which is why the README says never to ship it enabled. This is the opposite — a
 * front door that takes nothing at all and can only ever produce one session. Filing them
 * together would invite the reading that they are two settings of one thing.
 */

import { isDemoAccount } from '../src/domain/demo';
import { supabase } from './supabase';
import { useSession } from './session';

/**
 * The demo is not reachable: not deployed, not seeded, or too many people have asked in the
 * last ten minutes.
 *
 * One class for all three, and it is the same argument `DevLoginUnavailable` makes. They
 * have the same answer — come back in a minute — and separating them would mean the page
 * telling anyone who asks whether the project has a demo Account on it and how close the
 * rate limiter is to its cap. The exception is the `reason` field, which is read only to
 * choose between "in a moment" and "in a few minutes"; nothing branches on it further.
 */
export class DemoUnavailable extends Error {
  constructor(readonly reason: 'busy' | 'unavailable') {
    super('the demo is not available');
    this.name = 'DemoUnavailable';
  }
}

/**
 * Sign in as the shared demo Account.
 *
 * No arguments, deliberately: the Edge Function reads no parameters either, so there is
 * nothing on either side of this call that could point it at a different Account. If this
 * function grows an argument, that property is gone.
 *
 * Finishes with `verifyOtp` — the same call a real magic link makes when it lands — so
 * nothing downstream can tell a demo session apart from any other. That matters more than
 * it sounds: a demo that went down a special code path would be a demo of the special code
 * path.
 */
export const signInAsDemo = async (): Promise<void> => {
  const { data, error } = await supabase.functions.invoke<{ token_hash?: string }>(
    'demo-login',
    // An empty body rather than none: `invoke` sends a POST either way, and the function
    // answers 405 to anything that is not one.
    { body: {} },
  );

  if (error !== null) {
    // `invoke()` reports every non-2xx as one FunctionsHttpError, so the reason has to come
    // off the response body rather than off the status — the same shape `lib/auth.ts` uses
    // for `dev-login`, and for the same reason: `error.context` is the untouched Response,
    // because functions-js throws before reading the body.
    const response = (error as { context?: unknown }).context;
    const reason =
      response instanceof Response
        ? await response
            .json()
            .then((body: { reason?: unknown }) => body.reason)
            .catch(() => null)
        : null;
    throw new DemoUnavailable(reason === 'too_many' ? 'busy' : 'unavailable');
  }

  const tokenHash = data?.token_hash;
  if (typeof tokenHash !== 'string') throw new DemoUnavailable('unavailable');

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (verifyError !== null) throw new DemoUnavailable('unavailable');
};

/**
 * Whether the session on this device is the demo one.
 *
 * Read off the session's own address rather than from a query, and that is the whole reason
 * `DEMO_ACCOUNT_EMAIL` is a shared constant. The alternative — asking the server "am I the
 * demo" — is a round trip on every launch whose answer is already in hand, and a round trip
 * that can fail. **The marker must never be absent because a request did not come back**:
 * a demo that has quietly stopped saying it is one is the failure this whole feature has to
 * avoid.
 *
 * Answers `false` while the session is still being read (`undefined`), which is the right
 * way round: nothing is on screen yet.
 */
export const useIsDemo = (): boolean => {
  const session = useSession();
  return session != null && isDemoAccount(session.user.email);
};
