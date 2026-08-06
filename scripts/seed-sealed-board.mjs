/**
 * Seed one sealed Board on the LOCAL stack that puts every growth stage on screen at once.
 *
 * Slice 10's client half has never been looked at, because no sealed Board exists anywhere
 * in the dev data. This makes one — deliberately on local, never on the live project, since
 * sealing is irreversible (goals become immutable except through a Swap, §10.3).
 *
 *   node scripts/seed-sealed-board.mjs
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const status = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }),
);
const API = status.API_URL;
const SERVICE = status.SERVICE_ROLE_KEY;

const DB = execFileSync('docker',
  ['ps', '--format', '{{.Names}}', '--filter', 'name=supabase_db'],
  { encoding: 'utf8' }).trim().split('\n')[0];

const sql = (statement) =>
  execFileSync('docker',
    // `-q` matters: without it psql echoes "INSERT 0 1" after the RETURNING row, and the
    // id parsed out of that is a uuid with a command tag stuck to the end of it.
    ['exec', '-i', DB, 'psql', '-U', 'postgres', '-tAXq', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8' }).trim();

/**
 * The board, by position. `null` goal = a Tile nobody filled before the seal (§10.2) —
 * dashed border, no glyph. Row 0 is complete end to end so the pip row has a Line to light,
 * which is the only way to see that `completedLines()` is wired to real counts.
 *
 *   stage      = count / target
 *   dormant    0
 *   seeded     < 0.18
 *   sprouting  0.18 .. 0.82
 *   budding    >= 0.82, < 1
 *   complete   >= 1
 */
const BOARD = [
  { text: 'Swim a mile', target: 4, count: 4 },          //  0 complete
  { text: 'Learn ten knots', target: 4, count: 4 },      //  1 complete
  { text: 'Cook a new dish', target: 4, count: 4 },      //  2 complete
  { text: 'Call Gran', target: 4, count: 4 },            //  3 complete
  { text: 'Fix the shed door', target: 4, count: 4 },    //  4 complete  -> Line 0
  { text: 'Read 10 books', target: 10, count: 1, unit: 'books' },   //  5 seeded
  { text: 'Run 30 times', target: 30, count: 9, unit: 'runs' },     //  6 sprouting
  { text: 'Practise piano', target: 100, count: 90 },    //  7 budding
  { text: 'Plant the border', target: 5, count: 5 },     //  8 complete
  { text: 'Write a short story', target: 12, count: 0 }, //  9 dormant
  null,                                                  // 10 unfilled at seal
  { text: 'Walk the dog daily', target: 200, count: 14, unit: 'walks' }, // 11 seeded
  'CENTRE',                                              // 12 the shared Family Goal
  { text: 'Learn to solder', target: 25, count: 12 },    // 13 sprouting
  { text: 'Tidy the loft', target: 25, count: 22 },      // 14 budding
  { text: 'Ride to the coast', target: 1, count: 1 },    // 15 complete
  { text: 'Sourdough starter', target: 12, count: 0 },   // 16 dormant
  null,                                                  // 17 unfilled at seal
  { text: 'Swim weekly', target: 100, count: 50, unit: 'swims' },  // 18 sprouting
  { text: 'Learn 500 words', target: 100, count: 85 },   // 19 budding
  { text: 'Visit 12 parks', target: 12, count: 1, unit: 'parks' }, // 20 seeded
  { text: 'Draw something', target: 12, count: 6 },      // 21 sprouting
  { text: 'Climb every peak', target: 12, count: 11 },   // 22 budding
  { text: 'Yoga twelve times', target: 12, count: 12 },  // 23 complete
  { text: 'Build the bookshelf', target: 3, count: 0 },  // 24 dormant
];

const email = 'board@example.test';
const password = 'boardboard';

const main = async () => {
  // Idempotent: the same email and Family every run, so re-seeding does not litter the
  // stack with half a dozen identical Families to pick between at sign-in.
  sql(`delete from families where name = 'The Seeded Board'`);
  const existing = await fetch(`${API}/auth/v1/admin/users?filter=${email}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).then((r) => r.json());
  for (const user of existing.users ?? []) {
    await fetch(`${API}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  }

  // Invite-only sign-up (20260801000037) gates every identity GoTrue creates, including
  // one made through the admin API — the two are indistinguishable at the database. The
  // operator adds the address first, which is what invite-only means.
  sql(`insert into signup_allowlist (email, note)
       values ('${email}', 'local seed') on conflict (email) do nothing`);

  const created = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Rosa' } }),
  });
  if (!created.ok) throw new Error(await created.text());
  const accountId = (await created.json()).id;

  const [familyId, memberId, yearId, boardId, familyGoalId] = sql(`
    with f as (
      insert into families (name, timezone) values ('The Seeded Board', 'Europe/London')
      returning id),
    m as (
      insert into members (family_id, account_id, display_name, role, status)
      select f.id, '${accountId}', 'Rosa', 'organizer', 'active' from f
      returning id, family_id),
    y as (
      insert into years (family_id, calendar_year, status, center_mode, setup_deadline, sealed_at)
      select f.id, 2026, 'active', 'shared', now() - interval '30 days', now() - interval '30 days'
      from f returning id, family_id),
    fg as (
      insert into family_goals (year_id, text)
      select y.id, 'Eat dinner together every Sunday' from y returning id),
    b as (
      insert into boards (year_id, member_id, sealed_at)
      select y.id, m.id, now() - interval '30 days' from y, m returning id)
    select (select family_id from m) || ' ' || (select id from m) || ' ' ||
           (select id from y) || ' ' || (select id from b) || ' ' || (select id from fg)
  `).split(' ');

  let increments = 0;
  for (const [position, spec] of BOARD.entries()) {
    if (spec === 'CENTRE') {
      sql(`insert into tiles (board_id, position, family_goal_id)
           values ('${boardId}', ${position}, '${familyGoalId}')`);
      continue;
    }
    if (spec === null) {
      sql(`insert into tiles (board_id, position) values ('${boardId}', ${position})`);
      continue;
    }
    const unit = spec.unit === undefined ? 'null' : `'${spec.unit}'`;
    const tileId = sql(`
      with g as (
        insert into goals (text, target, unit)
        values ('${spec.text.replaceAll("'", "''")}', ${spec.target}, ${unit}) returning id)
      insert into tiles (board_id, position, goal_id)
      select '${boardId}', ${position}, g.id from g returning id`);

    // `occurred_at` defaults to now(). Not backdated on purpose: §11.5 refuses an Increment
    // that predates the seal, and a 90-tap Goal spread one-per-day reaches back three
    // months past a Board sealed thirty days ago. The counts are what this seed is for.
    for (let n = 0; n < spec.count; n += 1) {
      sql(`insert into increments (id, tile_id, member_id)
           values ('${randomUUID()}', '${tileId}', '${memberId}')`);
      increments += 1;
    }
  }

  console.log(JSON.stringify({
    signIn: { email, password },
    familyId, yearId, boardId,
    route: `/board/${boardId}`,
    increments,
  }, null, 2));
};

await main();
