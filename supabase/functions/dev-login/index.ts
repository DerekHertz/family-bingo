/**
 * A development sign-in that sends no email.
 *
 * **This is a back door. Read the paragraph before deploying it.**
 *
 * Supabase's default SMTP allows two emails an hour. Testing anything that involves two
 * people — an Invitation, an approval, a Centre vote — burns that in the first minute,
 * and then the project is unusable for the next fifty-nine. This exchanges an email
 * address for a session against an Account that *already exists*, with no email sent and
 * no rate limit spent.
 *
 * What keeps it from being an account-takeover endpoint for the whole internet:
 *
 *   - It is **inert unless `DEV_LOGIN_SECRET` is set** as an Edge Function secret. An
 *     unconfigured deployment answers 404 to every request, including a correct one. This
 *     is the switch: to turn the door off, delete the secret. Nothing has to be
 *     redeployed.
 *   - The secret must be **at least 32 characters**. A short one is treated as unset,
 *     because a guessable secret and no secret are the same thing.
 *   - It **never creates an Account.** The address is looked up first and a miss is a
 *     miss; `generateLink` on its own would happily sign a stranger up.
 *
 * It is still a back door, and the secret is the only thing standing in it. Do not set
 * `DEV_LOGIN_SECRET` on a project that holds anyone's real data.
 *
 * The response is a `token_hash` rather than a session: minting one here would mean
 * reimplementing token issuance, and GoTrue already does it correctly. The client spends
 * the hash on `verifyOtp` — the same call the real magic link makes when it lands.
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

/**
 * Below this a secret is guessable, and a guessable secret is not a gate.
 *
 * A floor on length, not a measure of entropy — `'a'.repeat(32)` clears it. The README's
 * `openssl rand -hex 32` is the actual advice; this only stops the two-character one.
 */
const MIN_SECRET = 32;

/**
 * The first function in this project a browser calls directly, and therefore the first
 * that needs these.
 *
 * `notify`, `wrap`, `sharpen` and `reap-attachments` are all reached from pg_net or a
 * database webhook, where there is no origin and no preflight. This one is invoked from
 * the app — and the only preview on the machine this is developed on is
 * `expo start --web` at `localhost:8081`, which makes every call cross-origin. Without a
 * preflight answer the browser blocks the request before the function runs, `invoke()`
 * throws a FunctionsFetchError with no status on it, and a correctly configured project
 * reports "dev sign-in isn't switched on".
 */
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const deny = (status: number, reason: string) =>
  new Response(JSON.stringify({ reason }), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });

/**
 * Compare without leaking length or prefix through timing.
 *
 * Digesting first makes both sides a fixed 32 bytes, so the loop below runs the same
 * number of times whatever was sent — length alone is otherwise a free oracle.
 */
const sameSecret = async (a: string, b: string): Promise<boolean> => {
  const encode = (s: string) => new TextEncoder().encode(s);
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(a)),
    crypto.subtle.digest('SHA-256', encode(b)),
  ]);
  const xs = new Uint8Array(x);
  const ys = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xs.length; i++) diff |= xs[i] ^ ys[i];
  return diff === 0;
};

interface AdminUser {
  id: string;
  email?: string;
  banned_until?: string | null;
  /** GoTrue exposes this and it means the auth user itself is gone, not just `accounts`. */
  deleted_at?: string | null;
}

/** Distinguishes "GoTrue said no such user" from "GoTrue did not answer". */
type Lookup =
  | { found: AdminUser }
  | { found: null }
  | { unreachable: true };

/**
 * Find the auth user for an address, or `null`.
 *
 * A raw fetch rather than `admin.listUsers()`, which pages through every user in the
 * project and has no way to ask about one address. The `filter` parameter is a substring
 * match server-side, so the exact comparison still has to happen here.
 */
const findUser = async (url: string, key: string, email: string): Promise<Lookup> => {
  // 100 is a ceiling, not a page walk. `filter` matches a substring of the email OR of
  // `full_name`, so a very common fragment could in principle push the wanted row past
  // the first page — at family scale it cannot, and the failure is to deny rather than to
  // return the wrong person. Worth knowing about before reusing this against a big
  // project.
  const query = new URLSearchParams({ filter: email, per_page: '100' });
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/admin/users?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch {
    return { unreachable: true };
  }
  // A rotated service key, a GoTrue 500 and a transport failure are not "no such
  // address", and saying they are sends someone off to check their typing for an hour.
  if (!res.ok) return { unreachable: true };

  const body = (await res.json()) as { users?: AdminUser[] };
  // The exact re-check is load-bearing, not belt and braces: `filter` is a substring
  // match against email AND display name, so it can return people who are not this
  // address at all.
  const wanted = email.toLowerCase();
  const hit = (body.users ?? []).find((u) => (u.email ?? '').toLowerCase() === wanted);
  return hit === undefined ? { found: null } : { found: hit };
};

Deno.serve(async (req) => {
  // Before everything, including the method check — a preflight is an OPTIONS and would
  // otherwise be answered 405 with no CORS headers, which the browser reads as a refusal.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const expected = Deno.env.get('DEV_LOGIN_SECRET') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // 404, not 403: an unconfigured project should look like it has no such function,
  // because as far as anyone outside is concerned it does not.
  //
  // First, and before the method check as well. A 405 on a GET would answer the one
  // question this endpoint must never answer for free — whether the back door is live on
  // this project — to anyone holding the anon key, which is everyone.
  if (expected.length < MIN_SECRET || url === '' || serviceKey === '') {
    return deny(404, 'not_found');
  }

  if (req.method !== 'POST') return deny(405, 'method_not_allowed');

  // A malformed body falls through to the secret check and gets the same 404, rather than
  // its own 400. The 400 was the same oracle in a different shape: an unconfigured
  // project answered 404 to junk and a configured one answered 400, which is the whole
  // question asked and answered without knowing the secret.
  let body: { email?: unknown; secret?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Deliberately empty — `secret` stays '' and the comparison below denies.
  }

  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!(await sameSecret(secret, expected))) return deny(404, 'not_found');

  // Past this line the caller holds the secret, so the answers can be specific: they are
  // the developer who set it up, and "no account with that address" is what they need.
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === '') return deny(400, 'no_email');

  const lookup = await findUser(url, serviceKey, email);
  if ('unreachable' in lookup) return deny(502, 'lookup_failed');
  if (lookup.found === null) return deny(404, 'no_account');
  const user = lookup.found;

  if (user.banned_until !== null && user.banned_until !== undefined) {
    if (Date.parse(user.banned_until) > Date.now()) return deny(403, 'banned');
  }
  // GoTrue's own soft delete, which anonymises the row rather than removing it. The
  // lookup above would normally miss it anyway; this is the belt.
  if (user.deleted_at !== null && user.deleted_at !== undefined) {
    return deny(403, 'no_account');
  }

  // There is deliberately no second check against `accounts`.
  //
  // The first draft read `accounts.deleted_at`, on the theory that §1.5's deletion was a
  // soft delete and an auth user could outlive the Account. Both halves were wrong, and
  // the mistake was worth keeping the note for. `delete_account()` does
  // `delete from auth.users where id = caller` and `accounts.id` references it
  // `on delete cascade`, so deletion is a hard delete of both and nothing ever sets that
  // column — a deleted Account is a lookup miss, one guard earlier.
  //
  // It also could not have worked: `service_role` has no SELECT on `accounts`. Migration
  // 24 grants "the grants the Edge Functions need, and not one more" precisely so this
  // role cannot read what it has no business reading, and widening it for a development
  // back door is the wrong direction. The query returned 42501 and this function answered
  // 502 to every correct request.

  // Generates the link without sending it — this is the whole trick. The Account is known
  // to exist by now, so the sign-up path this call would otherwise take is unreachable.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error !== null || data.properties === undefined) return deny(502, 'could_not_generate');

  return new Response(JSON.stringify({ token_hash: data.properties.hashed_token }), {
    status: 200,
    headers: { ...cors, 'content-type': 'application/json' },
  });
});
