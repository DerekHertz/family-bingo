/**
 * PRD §17.4 — the offline queue's contract with PostgREST.
 *
 *   Idempotency comes from the client-generated UUID (§11.2) — an upsert on primary key.
 *   No conflict resolution logic is needed.
 *
 * `offline_replay.test.sql` proves that property in SQL. This proves it over the wire,
 * because the queue will not be issuing SQL — it will be sending an HTTP request with a
 * `Prefer` header, and *which* header turns out to matter more than it looks.
 *
 * PostgREST's default upsert resolution is `merge-duplicates`, which is an UPDATE. There
 * is no UPDATE grant on `increments` and there is never going to be one: §11.3 makes the
 * log append-only and deleting is the only mutation permitted. A queue built on the
 * default would work in development, against a table someone had granted UPDATE on, and
 * fail the first time it retried in production.
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

const DB_CONTAINER = execFileSync('docker',
  ['ps', '--format', '{{.Names}}', '--filter', 'name=supabase_db'],
  { encoding: 'utf8' }).trim().split('\n')[0];

const sql = (statement: string): string =>
  execFileSync('docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-tAX',
     '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8' }).trim();

let token = '';
let familyId = '';
let memberId = '';
let tileId = '';
let accountId = '';

/** One tap, sent the way an offline queue drains: upsert on the id the device minted. */
const sync = (taps: { id: string; note?: string }[], resolution: string) =>
  fetch(`${API}/rest/v1/increments`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      Prefer: `resolution=${resolution}`,
    },
    body: JSON.stringify(
      taps.map((tap) => ({ id: tap.id, tile_id: tileId, member_id: memberId, note: tap.note ?? null })),
    ),
  });

const countIncrements = (): number => Number(sql(`select count(*) from increments`));

beforeAll(async () => {
  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();

  // Invite-only sign-up (20260801000037) gates **every** identity GoTrue creates. It
  // cannot do otherwise: an admin-API create and a public sign-up arrive on the same
  // connection as `supabase_auth_admin` and produce byte-identical rows, so the database
  // has no signal to tell them apart — probed both ways to be sure. An operator adds the
  // address first, and that is what invite-only means rather than a workaround.
  sql(`insert into signup_allowlist (email, note) values ('${email}', 'integration test')`);

  const createUser = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true,
                           user_metadata: { full_name: 'Alice' } }),
  });
  if (!createUser.ok) throw new Error(await createUser.text());
  accountId = (await createUser.json()).id as string;

  const ids = sql(`
    with f as (
      insert into families (name, timezone) values ('Sync Family', 'UTC') returning id),
    m as (
      insert into members (family_id, account_id, display_name, role, status)
      select f.id, '${accountId}', 'Alice', 'organizer', 'active' from f returning id, family_id),
    y as (
      insert into years (family_id, calendar_year, status, center_mode, setup_deadline, sealed_at)
      select f.id, 2027, 'active', 'personal', now(), now() from f returning id),
    b as (
      insert into boards (year_id, member_id, sealed_at)
      select y.id, m.id, now() from y, m returning id),
    g as (
      insert into goals (text, target) values ('Walk the dog', 3) returning id),
    t as (
      insert into tiles (board_id, position, goal_id)
      select b.id, 0, g.id from b, g returning id)
    select (select id from m) || ' ' || (select id from t) || ' ' || (select family_id from m)`);
  [memberId, tileId, familyId] = ids.split(' ');

  const signIn = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  token = (await signIn.json()).access_token as string;
}, 120_000);

afterAll(async () => {
  sql(`delete from families where id = '${familyId}'`);
  await fetch(`${API}/auth/v1/admin/users/${accountId}`, {
    method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
});

/** Three taps made with no network. The ids came from the device (§11.2). */
const queue = [{ id: randomUUID() }, { id: randomUUID() }, { id: randomUUID() }];

describe('§17.4 — the acceptance test, over the wire', () => {
  it('lands 3 Increments when connectivity returns', async () => {
    const response = await sync(queue, 'ignore-duplicates');
    expect(response.ok).toBe(true);
    expect(countIncrements()).toBe(3);
  });

  it('creates no duplicates when the sync runs again', async () => {
    const response = await sync(queue, 'ignore-duplicates');
    expect(response.ok).toBe(true);
    expect(countIncrements()).toBe(3);
  });

  it('and no duplicates after five more', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await sync(queue, 'ignore-duplicates')).ok).toBe(true);
    }
    expect(countIncrements()).toBe(3);
  });

  it('fires the Tile completion exactly once across every replay', () => {
    expect(Number(sql(`select count(*) from milestones where type = 'tile_completed'`))).toBe(1);
    // §15.3: a replay that re-notifies the Family spends a permission it cannot get back.
    expect(Number(sql(`select count(*) from notifications where kind = 'tile_completed'`))).toBe(0);
  });

  it('accepts a partly-drained queue without the client knowing what landed', async () => {
    const partial = [queue[0], { id: randomUUID() }];
    expect((await sync(partial, 'ignore-duplicates')).ok).toBe(true);
    expect(countIncrements()).toBe(4);
  });
});

describe("§11.3 — and why the default header doesn't work", () => {
  it('refuses merge-duplicates, because there is no UPDATE grant', async () => {
    const response = await fetch(`${API}/rest/v1/increments`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        // PostgREST's default. An UPDATE in all but name.
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([{ id: queue[0].id, tile_id: tileId, member_id: memberId,
                              note: 'overwritten' }]),
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
  });

  it('so a replay can never rewrite what the first tap said', () => {
    expect(sql(`select coalesce(note, '<null>') from increments where id = '${queue[0].id}'`))
      .toBe('<null>');
  });
});
