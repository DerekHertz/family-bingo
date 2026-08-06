/**
 * A session for the public demo Account. No secret, on purpose.
 *
 * **This is deliberately open, and it is not the same shape as `dev-login`.** That one is a
 * back door: it takes an address and a secret, and it can produce a session for any Account
 * on the project, which is why it must never ship enabled. This one takes nothing at all.
 * It reads no parameters, and the address it signs in is a compile-time constant
 * (`src/domain/demo.ts`) — so there is no input for a caller to influence and no version of
 * this request that produces a session for anybody else.
 *
 * WHY THERE IS NO SECRET
 * -----------------------------------------------------------------------------------------
 * The only caller is a web page anyone can load. A secret it holds is a secret in the
 * bundle, readable with view-source — `EXPO_PUBLIC_*` is Expo's instruction to inline the
 * literal, which is exactly why the README forbids putting `DEV_LOGIN_SECRET` anywhere near
 * the deploy. A gate that everyone holds the key to is not a gate; it is a gate that makes
 * the endpoint *look* protected, which is worse than an endpoint that is honestly public.
 *
 * WHAT STANDS IN THE DOOR INSTEAD
 * -----------------------------------------------------------------------------------------
 *   1. **One Account, structurally.** `DEMO_ACCOUNT_EMAIL` is a constant, the body is never
 *      read, and `generateLink` is called with that constant. Repointing this at another
 *      Account takes a code change and a deploy, not a crafted request.
 *   2. **It never creates an Account.** The address is looked up first and a miss is a miss
 *      — `generateLink` on its own would happily sign a stranger up, and the demo Account
 *      not existing means the demo has not been seeded, not that one should be invented.
 *   3. **What the session can do is nothing.** The demo Family's Year is frozen, so §20.1's
 *      existing enforcement makes the game read-only at RLS; `20260801000039` refuses the
 *      handful of writes that live outside a Year. That is the real containment. This
 *      function is only the door.
 *   4. **Rate limited**, per caller and globally — `demo_login_allowed()` in
 *      `20260801000039_demo_account.sql`, which explains both caps.
 *
 * The response is a `token_hash` rather than a session, for the same reason `dev-login`
 * answers one: minting a session here would mean reimplementing token issuance, and GoTrue
 * already does it correctly. The client spends the hash on `verifyOtp` — the same call a
 * real magic link makes when it lands.
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { DEMO_ACCOUNT_EMAIL } from '../../../src/domain/demo.ts';

/**
 * The browser calls this directly, so it needs a preflight answer — the same reason
 * `dev-login` grew one. `notify`, `wrap`, `sharpen` and `reap-attachments` are reached from
 * pg_net, where there is no origin and no preflight.
 *
 * `*` rather than the deployed origin: this endpoint is public by design, so an origin
 * allowlist would restrict nothing while breaking `expo start --web` on a laptop.
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
 * An opaque, stable handle for one caller — never their address.
 *
 * Rate limiting needs to tell callers apart; it does not need to know who they are, and a
 * table of visitors' IP addresses is personal data collected to protect a page that holds
 * none. HMAC-SHA-256 under the service key gives a handle that is stable for as long as the
 * key is, and unguessable without it — so the column cannot be reversed by trying all four
 * billion IPv4 addresses, which a bare hash could be.
 *
 * `x-forwarded-for` is a list; the first entry is the client as the edge saw it. A caller
 * can send whatever they like in it, which matters less than it sounds: the header is
 * rewritten by the platform in front of this function, and the global cap is what actually
 * bounds someone who forges one.
 */
const callerHandle = async (req: Request, key: string): Promise<string> => {
  const forwarded = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const address = forwarded !== '' ? forwarded : (req.headers.get('cf-connecting-ip') ?? '');
  // Everyone the platform did not identify shares one bucket. That is the right failure:
  // unattributed traffic is limited together rather than not at all.
  const subject = address !== '' ? address : 'unattributed';

  const secret = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(subject));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    // Half a SHA-256 is 128 bits, which has no collisions at this scale and keeps the
    // primary key narrow.
    .slice(0, 32);
};

interface AdminUser {
  id: string;
  email?: string;
  banned_until?: string | null;
  deleted_at?: string | null;
}

/**
 * Find the demo Account, or `null`.
 *
 * A raw fetch rather than `admin.listUsers()`, which pages through every user in the project
 * and has no way to ask about one address — the same reasoning as `dev-login`, and the exact
 * re-check below is load-bearing for the same reason: `filter` is a *substring* match against
 * email and display name, so it can return people who are not this address at all.
 */
const findDemoUser = async (url: string, key: string): Promise<AdminUser | null> => {
  const query = new URLSearchParams({ filter: DEMO_ACCOUNT_EMAIL, per_page: '100' });
  const res = await fetch(`${url}/auth/v1/admin/users?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { users?: AdminUser[] };
  return (
    (body.users ?? []).find((u) => (u.email ?? '').toLowerCase() === DEMO_ACCOUNT_EMAIL) ?? null
  );
};

Deno.serve(async (req) => {
  // Before the method check: a preflight is an OPTIONS and would otherwise be answered 405
  // with no CORS headers, which the browser reads as a refusal.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return deny(405, 'method_not_allowed');

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (url === '' || serviceKey === '') return deny(500, 'not_configured');

  // **The request body is never read.** Not parsed, not validated, not logged. There is
  // nothing in it this function would do anything with, and a parameter that exists is a
  // parameter somebody will eventually make mean something.

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: allowed, error: limitError } = await db.rpc('demo_login_allowed', {
    handle: await callerHandle(req, serviceKey),
  });
  // Fail **closed**. If the limiter cannot answer, the door does not open — an unlimited
  // public session endpoint is not a safe degradation, and the demo being briefly
  // unavailable is.
  if (limitError !== null) return deny(503, 'unavailable');
  if (allowed !== true) return deny(429, 'too_many');

  const user = await findDemoUser(url, serviceKey);
  // 404 and not 500: as far as anyone outside is concerned, a project with no demo seeded
  // has no demo. `scripts/seed-demo-family.mjs` is what makes this stop being true.
  if (user === null) return deny(404, 'no_demo');
  if (user.deleted_at !== null && user.deleted_at !== undefined) return deny(404, 'no_demo');
  if (user.banned_until !== null && user.banned_until !== undefined) {
    if (Date.parse(user.banned_until) > Date.now()) return deny(404, 'no_demo');
  }

  // Generates the link without sending it. The Account is known to exist by now, so the
  // sign-up path this call would otherwise take is unreachable — which is the guard that
  // stops this endpoint being a way to create Accounts past `signup_allowlist`.
  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: DEMO_ACCOUNT_EMAIL,
  });
  if (error !== null || data.properties === undefined) return deny(502, 'could_not_generate');

  return new Response(JSON.stringify({ token_hash: data.properties.hashed_token }), {
    status: 200,
    headers: { ...cors, 'content-type': 'application/json' },
  });
});
