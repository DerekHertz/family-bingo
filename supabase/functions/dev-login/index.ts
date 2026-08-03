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

/** Below this a secret is guessable, and a guessable secret is not a gate. */
const MIN_SECRET = 32;

const deny = (status: number, reason: string) =>
  new Response(JSON.stringify({ reason }), {
    status,
    headers: { 'content-type': 'application/json' },
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
}

/**
 * Find the auth user for an address, or `null`.
 *
 * A raw fetch rather than `admin.listUsers()`, which pages through every user in the
 * project and has no way to ask about one address. The `filter` parameter is a substring
 * match server-side, so the exact comparison still has to happen here.
 */
const findUser = async (
  url: string,
  key: string,
  email: string,
): Promise<AdminUser | null> => {
  const query = new URLSearchParams({ filter: email, per_page: '100' });
  const res = await fetch(`${url}/auth/v1/admin/users?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { users?: AdminUser[] };
  const wanted = email.toLowerCase();
  return (body.users ?? []).find((u) => (u.email ?? '').toLowerCase() === wanted) ?? null;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return deny(405, 'method_not_allowed');

  const expected = Deno.env.get('DEV_LOGIN_SECRET') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // 404, not 403: an unconfigured project should look like it has no such function,
  // because as far as anyone outside is concerned it does not.
  if (expected.length < MIN_SECRET || url === '' || serviceKey === '') {
    return deny(404, 'not_found');
  }

  let body: { email?: unknown; secret?: unknown };
  try {
    body = await req.json();
  } catch {
    return deny(400, 'unreadable_request');
  }

  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!(await sameSecret(secret, expected))) return deny(404, 'not_found');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === '') return deny(400, 'no_email');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const user = await findUser(url, serviceKey, email);
  if (user === null) return deny(404, 'no_account');

  if (user.banned_until !== null && user.banned_until !== undefined) {
    if (Date.parse(user.banned_until) > Date.now()) return deny(403, 'banned');
  }

  // §1.5's deletion is a soft delete on `accounts`, so an auth user can outlive the
  // Account it belongs to. Signing that one in would produce a session whose every query
  // returns nothing — a worse outcome than being turned away.
  const { data: account } = await admin
    .from('accounts')
    .select('deleted_at')
    .eq('id', user.id)
    .maybeSingle();
  if (account === null || account.deleted_at !== null) return deny(403, 'no_account');

  // Generates the link without sending it — this is the whole trick. The Account is known
  // to exist by now, so the sign-up path this call would otherwise take is unreachable.
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error !== null || data.properties === undefined) return deny(502, 'could_not_generate');

  return new Response(JSON.stringify({ token_hash: data.properties.hashed_token }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
