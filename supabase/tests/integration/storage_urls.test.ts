/**
 * PRD §16.5 — "the single highest-consequence test in the suite".
 *
 *   An unauthenticated request and a wrong-Family authenticated request must both fail
 *   against a real object URL.
 *
 * `storage_attachments.test.sql` proves the boundary holds inside Postgres, and says
 * plainly that it cannot prove this half: a signed URL is minted by the Storage API, not
 * by a policy, so nothing in pgTAP can tell you whether the bytes come back over HTTP.
 * This file asks the running Storage service for the bytes and checks that it refuses.
 *
 * Everything else in this app leaking is embarrassing. This leaking is not — the payload
 * is photographs of children (ADR-0005).
 *
 * Raw `fetch`, no client library. The requirement is a claim about what a real endpoint
 * returns to a real HTTP request, and a client library sits between the test and the
 * thing being tested — it can normalize a 200 into an error object, or an error into
 * null, and either would hide the answer. It also means this suite has no dependency
 * that could pin the repo's Node version.
 *
 * Runs against the local stack, not in `npm test`:
 *
 *     npm run db:start && npm run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const status = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }),
) as Record<string, string>;

const API = status.API_URL;
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
const BUCKET = 'attachments';

/** A one-pixel JPEG. The bytes do not matter; who can fetch them does. */
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

const headers = (token: string, extra: Record<string, string> = {}) => ({
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  ...extra,
});

/**
 * Fixtures go in through psql, not PostgREST.
 *
 * `service_role` is granted four tables and nothing else (20260801000024), which is the
 * right amount for the Edge Functions and nowhere near enough to build a Family. Widening
 * those grants so a test could reach them would be letting the test dictate the
 * production surface, on the one role that bypasses RLS.
 *
 * The split is deliberate: everything the test ASSERTS goes over HTTP, because that is
 * the requirement. Only the scaffolding takes the back door.
 */
const DB_CONTAINER = execFileSync('docker',
  ['ps', '--format', '{{.Names}}', '--filter', 'name=supabase_db'],
  { encoding: 'utf8' }).trim().split('\n')[0];

const sql = (statement: string): string =>
  execFileSync('docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-tAX',
     '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8' }).trim();

interface Player {
  familyId: string;
  incrementId: string;
  objectPath: string;
  token: string;
  accountId: string;
}

const cleanup: Array<() => Promise<unknown>> = [];

/**
 * A Family with one Member, a sealed Board, an Increment and a photo — the smallest
 * arrangement in which an Attachment can legally exist. Built through the service role
 * because this is a test about Storage, not about whether the RPCs work; those have
 * slices of their own.
 */
const makeFamily = async (name: string): Promise<Player> => {
  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();

  // Invite-only sign-up (20260801000037) gates **every** identity GoTrue creates — and it
  // cannot do otherwise: an admin-API create and a public sign-up arrive on the same
  // connection as `supabase_auth_admin` and produce rows that are byte-identical, so the
  // database has no signal to tell them apart. Probed both ways to be sure.
  //
  // So an operator adds the address first, and that is what "invite-only" means rather
  // than a workaround. Doing it here keeps the local stack behaving exactly like the live
  // project, which is worth more than the two lines it costs.
  sql(`insert into signup_allowlist (email, note) values ('${email}', 'integration test')`);

  const createUser = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email, password, email_confirm: true, user_metadata: { full_name: name },
    }),
  });
  if (!createUser.ok) throw new Error(`createUser: ${await createUser.text()}`);
  const accountId = (await createUser.json()).id as string;

  const incrementId = randomUUID();

  // One statement, so a half-built Family cannot survive a failure partway down.
  const familyId = sql(`
    with f as (
      insert into families (name, timezone) values ('${name} Family', 'UTC') returning id),
    m as (
      insert into members (family_id, account_id, display_name, role, status)
      select f.id, '${accountId}', '${name}', 'organizer', 'active' from f returning id),
    y as (
      insert into years (family_id, calendar_year, status, center_mode,
                         setup_deadline, sealed_at)
      select f.id, 2027, 'active', 'personal', now(), now() from f returning id),
    b as (
      insert into boards (year_id, member_id, sealed_at)
      select y.id, m.id, now() from y, m returning id),
    g as (
      insert into goals (text, target) values ('Walk the dog', 10) returning id),
    t as (
      insert into tiles (board_id, position, goal_id)
      select b.id, 0, g.id from b, g returning id),
    i as (
      insert into increments (id, tile_id, member_id)
      select '${incrementId}', t.id, m.id from t, m returning id)
    select (select id from f)`);

  const signIn = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) throw new Error(`signIn: ${await signIn.text()}`);
  const token = (await signIn.json()).access_token as string;

  const objectPath = `${familyId}/${incrementId}.jpg`;

  cleanup.push(async () => {
    await fetch(`${API}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'DELETE', headers: headers(SERVICE),
    });
    sql(`delete from families where id = '${familyId}'`);
    await fetch(`${API}/auth/v1/admin/users/${accountId}`, {
      method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  });

  return { familyId, incrementId, objectPath, token, accountId };
};

const signedUrlFor = async (token: string, path: string) =>
  fetch(`${API}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: headers(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 60 }),
  });

/**
 * The **batch** endpoint, which is what the client actually calls.
 *
 * `useSignedPhotos` signs a whole Feed page in one request (`createSignedUrls`), because
 * one `createSignedUrl` per row is thirty requests on a screen that exists to be scrolled.
 * That is a different endpoint from the one every test above exercises, and §16.5 is a
 * claim about what a real endpoint returns — so it gets asserted rather than assumed.
 */
const signedUrlsFor = async (token: string, paths: string[]) =>
  fetch(`${API}/storage/v1/object/sign/${BUCKET}`, {
    method: 'POST',
    headers: headers(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 60, paths }),
  });

interface BatchSignature {
  error: string | null;
  path: string | null;
  signedURL: string | null;
}

let alice: Player;
let bob: Player;

beforeAll(async () => {
  alice = await makeFamily('Alice');
  bob = await makeFamily('Bob');

  const upload = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`, {
    method: 'POST',
    headers: headers(alice.token, { 'content-type': 'image/jpeg' }),
    body: PHOTO,
  });
  if (!upload.ok) throw new Error(`upload: ${upload.status} ${await upload.text()}`);

  sql(`insert into attachments (increment_id, storage_path)
       values ('${alice.incrementId}', '${alice.objectPath}')`);

  // Bob gets a photo of his own. Without one, every refusal below is consistent with a
  // Storage service that simply answers nothing to anybody — and a boundary test that
  // passes when the feature is broken is not a boundary test.
  const bobUpload = await fetch(`${API}/storage/v1/object/${BUCKET}/${bob.objectPath}`, {
    method: 'POST',
    headers: headers(bob.token, { 'content-type': 'image/jpeg' }),
    body: PHOTO,
  });
  if (!bobUpload.ok) throw new Error(`bob upload: ${bobUpload.status} ${await bobUpload.text()}`);

  sql(`insert into attachments (increment_id, storage_path)
       values ('${bob.incrementId}', '${bob.objectPath}')`);
}, 120_000);

afterAll(async () => {
  for (const undo of cleanup) await undo();
});

describe('§16.2 — the bucket is private', () => {
  it('refuses the public object URL, with no token at all', async () => {
    const response = await fetch(`${API}/storage/v1/object/public/${BUCKET}/${alice.objectPath}`);
    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses the authenticated object URL to a caller with only the anon key', async () => {
    const response = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`, {
      headers: headers(ANON),
    });
    expect(response.ok).toBe(false);
  });

  it('refuses it with no headers whatsoever', async () => {
    const response = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`);
    expect(response.ok).toBe(false);
  });
});

describe('§16.5 — a real object URL, and who it refuses', () => {
  it('gives Alice her own photo through a signed URL', async () => {
    const signed = await signedUrlFor(alice.token, alice.objectPath);
    expect(signed.ok).toBe(true);

    const { signedURL } = await signed.json();
    const response = await fetch(`${API}/storage/v1${signedURL}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PHOTO);
  });

  it('ANON: refuses an unauthenticated download of the exact path', async () => {
    const response = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`, {
      headers: headers(ANON),
    });
    expect(response.ok).toBe(false);
  });

  it('ANON: will not mint a signed URL for it either', async () => {
    const response = await signedUrlFor(ANON, alice.objectPath);
    expect(response.ok).toBe(false);
  });

  it('CROSS-FAMILY: refuses Bob the download, though he knows the exact path', async () => {
    const response = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`, {
      headers: headers(bob.token),
    });
    expect(response.ok).toBe(false);
  });

  it('CROSS-FAMILY: will not mint Bob a signed URL for it', async () => {
    const response = await signedUrlFor(bob.token, alice.objectPath);
    expect(response.ok).toBe(false);
  });

  it('CROSS-FAMILY: Bob cannot list the folder to find it', async () => {
    const response = await fetch(`${API}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: headers(bob.token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: alice.familyId, limit: 100 }),
    });
    expect(await response.json()).toHaveLength(0);
  });

  it('CROSS-FAMILY: Bob cannot plant an object inside it', async () => {
    const response = await fetch(
      `${API}/storage/v1/object/${BUCKET}/${alice.familyId}/${randomUUID()}.jpg`, {
        method: 'POST',
        headers: headers(bob.token, { 'content-type': 'image/jpeg' }),
        body: PHOTO,
      });
    expect(response.ok).toBe(false);
  });

  it('a tampered signature is refused, so the token is the whole authority', async () => {
    const { signedURL } = await (await signedUrlFor(alice.token, alice.objectPath)).json();
    const tampered = `${API}/storage/v1${signedURL}`.replace(/token=.*/, 'token=not-a-real-token');
    const response = await fetch(tampered);
    expect(response.ok).toBe(false);
  });
});

/**
 * §16.5 again, against the endpoint the client actually uses.
 *
 * Slice 16's client signs a whole Feed page in one request, and a batch endpoint has a
 * failure mode a single-path one does not: it answers a *list*, so it has to decide what
 * to do about a caller who may read some of the paths and not others. If it answered
 * all-or-nothing, `useSignedPhotos` would still be safe but useless — one refused row
 * would blank the page. If it answered a URL for every path asked for, it would hand a
 * Family's photographs to anyone who could guess a key, and the singular endpoint's
 * careful refusals above would be beside the point.
 *
 * It filters, per path. `useSignedPhotos` is written to that contract — it skips entries
 * carrying an `error` and keeps the rest — and this is where that contract is checked
 * rather than believed.
 */
describe('§16.5 — the batch endpoint the client signs with', () => {
  it('signs Alice her own page', async () => {
    const response = await signedUrlsFor(alice.token, [alice.objectPath]);
    expect(response.ok).toBe(true);

    const [signature] = (await response.json()) as BatchSignature[];
    expect(signature?.error).toBeNull();
    expect(signature?.signedURL).toBeTruthy();

    const photo = await fetch(`${API}/storage/v1${signature?.signedURL ?? ''}`);
    expect(photo.status).toBe(200);
  });

  it('CROSS-FAMILY: gives Bob nothing for Alice’s path, though he asks in a batch', async () => {
    const response = await signedUrlsFor(bob.token, [alice.objectPath]);
    const signatures = (await response.json()) as BatchSignature[];
    for (const signature of signatures) {
      expect(signature.signedURL).toBeFalsy();
    }
  });

  it('CROSS-FAMILY: a mixed batch answers Bob his own and refuses Alice’s', async () => {
    // The one that matters. A Member of two Families scrolls a Feed carrying both, and an
    // endpoint that leaked on a mixed request would leak on the ordinary case rather than
    // on a contrived one.
    const response = await signedUrlsFor(bob.token, [bob.objectPath, alice.objectPath]);
    expect(response.ok).toBe(true);

    const signatures = (await response.json()) as BatchSignature[];
    const usable = signatures.filter((s) => s.signedURL !== null && s.signedURL !== '');
    expect(usable.map((s) => s.path)).toEqual([bob.objectPath]);

    // And the URL it did give him is his own photo, not a redirect into Alice's folder.
    const photo = await fetch(`${API}/storage/v1${usable[0]?.signedURL ?? ''}`);
    expect(photo.status).toBe(200);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PHOTO);
  });

  it('ANON: signs nothing at all in a batch', async () => {
    const response = await signedUrlsFor(ANON, [alice.objectPath]);
    if (response.ok) {
      const signatures = (await response.json()) as BatchSignature[];
      for (const signature of signatures) expect(signature.signedURL).toBeFalsy();
    } else {
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('a signed URL expires, which is the whole of the exposure window (§16.2)', async () => {
    // Nothing revokes a signed URL — it is a stateless HMAC over the path and an expiry,
    // and Storage consults no table before honouring one. So "short TTL" is not a tuning
    // knob, it is the security control, and an expiry that Storage ignored would mean
    // every URL this app has ever minted is still good.
    const response = await fetch(`${API}/storage/v1/object/sign/${BUCKET}/${alice.objectPath}`, {
      method: 'POST',
      headers: headers(alice.token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ expiresIn: -1 }),
    });

    if (!response.ok) {
      // Refusing to mint an already-expired URL is a stronger answer than honouring the
      // expiry, and either is correct.
      expect(response.status).toBeGreaterThanOrEqual(400);
      return;
    }
    const { signedURL } = (await response.json()) as { signedURL: string };
    const expired = await fetch(`${API}/storage/v1${signedURL}`);
    expect(expired.ok).toBe(false);
  });
});

describe('§16.6 — deleting an Increment deletes the photo', () => {
  it('removes the bytes, not just the row', async () => {
    // Postgres cannot do this itself: storage.protect_delete() refuses everyone,
    // superuser included. The Attachment going away records that a removal is owed, in
    // the same commit, and the reaper carries it out through this API.
    sql(`delete from increments where id = '${alice.incrementId}'`);

    // Read over HTTP as the service role, because this is also the grant that
    // reap-attachments depends on (20260801000024).
    const owedResponse = await fetch(
      `${API}/rest/v1/orphaned_objects?reaped_at=is.null&object_path=eq.${alice.objectPath}`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    expect(owedResponse.ok).toBe(true);
    expect(await owedResponse.json()).toHaveLength(1);

    // Exactly what reap-attachments does, against the same endpoint it would call.
    const removed = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`, {
      method: 'DELETE', headers: headers(SERVICE),
    });
    expect(removed.ok).toBe(true);

    // The photo is gone for its owner, which is the only proof that matters.
    const response = await fetch(`${API}/storage/v1/object/${BUCKET}/${alice.objectPath}`, {
      headers: headers(alice.token),
    });
    expect(response.ok).toBe(false);
  }, 60_000);
});
