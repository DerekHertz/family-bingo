/**
 * Build the public demo: one Family, one finished Year, one shared Account to view it as.
 *
 *   node scripts/seed-demo-family.mjs                 # the local stack
 *   DEMO_DB_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-demo-family.mjs
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 * -----------------------------------------------------------------------------------------
 * The rules the demo needs — the `demo_account` marker, the three write guards, the
 * rate limiter — *are* schema, and they are in `20260801000039_demo_account.sql`. The
 * Family, the Goals and a year of Increments are content, and content in a migration is
 * wrong here for three separate reasons, any one of which would decide it:
 *
 *   1. **A migration runs everywhere, including CI and every `db reset`.** Several pgTAP
 *      suites do `select id from families limit 1` (HANDOFF names this exact trap), so a
 *      demo Family present in every reset would fail roughly thirty assertions for reasons
 *      that have nothing to do with the change under test. That alone settles it.
 *   2. **Migrations are append-only; content is not.** Rewording a Goal or re-recording the
 *      demo would become migration 040, then 041 — a permanent log of edits to a fixture.
 *   3. **This is time-dependent.** It seeds "last year" and then freezes it. A migration
 *      replayed in 2029 would mean something different from the same migration applied in
 *      2026, which is the one thing a migration may never do.
 *
 * The price is that it has to be run by hand, once, against the live project — and unlike
 * `seed-sealed-board.mjs`, which is local-only because sealing is irreversible, this one is
 * *meant* to run against production. The README says how.
 *
 * WHAT MAKES IT SAFE TO RUN TWICE
 * -----------------------------------------------------------------------------------------
 * It deletes the demo Family and the three seed Accounts first, every time. There is no
 * merge path and no partial update: re-running replaces the demo wholesale. Nothing outside
 * the demo is touched — the Family is found by name, the Accounts by address, and both are
 * in a namespace (`@family-bingo.pages.dev`) no real person can hold.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------------------
// Who is in the demo
// ---------------------------------------------------------------------------------------

/**
 * The one Account the public demo signs in as, and the only address `demo-login` knows.
 *
 * Held in `src/domain/demo.ts` rather than here, because three places need to agree on it
 * and two of them are not this script: the Edge Function that mints the session, and the
 * client that decides whether to draw the demo marker. A constant copied into three files
 * is a constant that will eventually differ in one of them.
 *
 * `.pages.dev` is the deployment's own domain. It is a real, resolvable name that nobody
 * can receive mail at and nobody can register a Google identity under, which is exactly
 * what an address that must never be signable-in-to by a human should be.
 *
 * The `.ts` on the specifier is required, not a slip: Node 22 strips types from a file it
 * is told to load and has no resolver step that would turn `demo.js` into `demo.ts`.
 */
import { DEMO_ACCOUNT_EMAIL } from '../src/domain/demo.ts';

const FAMILY_NAME = 'The Ferreira Family';
const TIMEZONE = 'Europe/London';

/**
 * Supporting Accounts. They exist because a Family is a real participant (§1) — the Feed,
 * the Awards and the Family Goal are all meaningless with one person in the room — and for
 * no other reason. Neither can be signed in to: `demo-login` will only ever produce a
 * session for `DEMO_ACCOUNT_EMAIL`, and there is no other passwordless route to an address
 * that receives no mail.
 */
const ORGANIZER_EMAIL = 'nadia@family-bingo.pages.dev';
const LATE_JOINER_EMAIL = 'priya@family-bingo.pages.dev';

// ---------------------------------------------------------------------------------------
// The boards
// ---------------------------------------------------------------------------------------

/**
 * The demo Member's Board, by position, and it is laid out to be looked at.
 *
 * Row 0 completes end to end — that is the Bingo — and column 0 completes as well, so the
 * pip strip beneath the Board has two of its twelve segments lit and the Feed carries one
 * `bingo` and one `line_completed`. Every growth stage in §2's ladder appears at least
 * three times, because a screenshot of one dormant square proves nothing:
 *
 *   dormant    count 0
 *   seeded     < 18%
 *   sprouting  18–81%
 *   budding    82–99%
 *   complete   >= 100%
 *
 * Position 12 is the Centre and carries the Family Goal, not a personal one (§4.3).
 */
const CENTRE = 'CENTRE';

const DEMO_BOARD = [
  { text: 'Swim a mile without stopping', target: 4, count: 4, unit: 'swims', canonical: 'swim', category: 'fitness' },
  { text: 'Learn ten useful knots', target: 10, count: 10, unit: 'knots', canonical: 'knot', category: 'learning' },
  { text: 'Cook something I have never cooked', target: 6, count: 6, unit: 'dishes', canonical: 'dish', category: 'creative' },
  { text: 'Ring Gran on a Sunday', target: 12, count: 12, unit: 'calls', canonical: 'call', category: 'family' },
  { text: 'Fix the shed door', target: 1, count: 1, category: 'other' },
  { text: 'Read ten books', target: 10, count: 10, unit: 'books', canonical: 'book', category: 'learning' },
  { text: 'Run thirty times', target: 30, count: 9, unit: 'runs', canonical: 'run', category: 'fitness' },
  { text: 'Practise the piano', target: 100, count: 90, unit: 'sessions', canonical: 'session', category: 'creative' },
  { text: 'Plant out the border', target: 5, count: 5, unit: 'beds', canonical: 'bed', category: 'creative' },
  { text: 'Write a short story', target: 12, count: 0, unit: 'drafts', canonical: 'draft', category: 'creative' },
  { text: 'Walk the dog before work', target: 200, count: 200, unit: 'walks', canonical: 'walk', category: 'health' },
  { text: 'Learn to solder properly', target: 25, count: 3, unit: 'joints', canonical: 'joint', category: 'learning' },
  CENTRE,
  { text: 'Clear the loft, one box at a time', target: 25, count: 22, unit: 'boxes', canonical: 'box', category: 'other' },
  { text: 'Ride to the coast in one go', target: 1, count: 0, category: 'fitness' },
  { text: 'Swim every week', target: 40, count: 40, unit: 'swims', canonical: 'swim', category: 'fitness' },
  { text: 'Keep a sourdough starter alive', target: 12, count: 0, unit: 'bakes', canonical: 'bake', category: 'creative' },
  { text: 'Visit twelve parks', target: 12, count: 1, unit: 'parks', canonical: 'park', category: 'family' },
  { text: 'Draw something, anything', target: 12, count: 6, unit: 'drawings', canonical: 'drawing', category: 'creative' },
  { text: 'Learn five hundred words of Portuguese', target: 500, count: 430, unit: 'words', canonical: 'word', category: 'learning' },
  { text: 'Yoga twelve times', target: 12, count: 12, unit: 'sessions', canonical: 'session', category: 'health' },
  { text: 'Climb every peak on the map', target: 12, count: 11, unit: 'peaks', canonical: 'peak', category: 'fitness' },
  { text: 'Build the bookshelf', target: 3, count: 1, unit: 'shelves', canonical: 'shelf', category: 'other' },
  { text: 'Sixty cold swims', target: 60, count: 25, unit: 'swims', canonical: 'swim', category: 'health' },
  { text: 'Cycle to work', target: 100, count: 0, unit: 'rides', canonical: 'ride', category: 'fitness' },
];

/**
 * The Organizer's Board. Fewer stages on purpose — nobody sees this grid, and its whole job
 * is to put a second real person in the Feed, the unit aggregation and the Awards. It
 * finishes a Line so that Wrapped has more than one Member with something to say.
 */
const ORGANIZER_BOARD = [
  { text: 'Swim in the sea every month', target: 12, count: 12, unit: 'swims', canonical: 'swim', category: 'health' },
  { text: 'Finish the Portuguese course', target: 30, count: 30, unit: 'lessons', canonical: 'lesson', category: 'learning' },
  { text: 'Bake bread on Sundays', target: 40, count: 40, unit: 'bakes', canonical: 'bake', category: 'creative' },
  { text: 'Call Mum every week', target: 52, count: 52, unit: 'calls', canonical: 'call', category: 'family' },
  { text: 'Put something aside each month', target: 12, count: 12, unit: 'payments', canonical: 'payment', category: 'money' },
  { text: 'Read twenty books', target: 20, count: 17, unit: 'books', canonical: 'book', category: 'learning' },
  { text: 'Couch to 5k, twice over', target: 18, count: 12, unit: 'runs', canonical: 'run', category: 'fitness' },
  { text: 'Learn the ukulele', target: 60, count: 41, unit: 'sessions', canonical: 'session', category: 'creative' },
  { text: 'Cycle a hundred miles', target: 100, count: 100, unit: 'miles', canonical: 'mile', category: 'fitness' },
  { text: 'Grow something from seed', target: 6, count: 6, unit: 'plants', canonical: 'plant', category: 'creative' },
  { text: 'Write to a friend by hand', target: 12, count: 4, unit: 'letters', canonical: 'letter', category: 'family' },
  { text: 'Walk ten thousand steps', target: 200, count: 156, unit: 'walks', canonical: 'walk', category: 'health' },
  CENTRE,
  { text: 'No phone before breakfast', target: 300, count: 214, unit: 'mornings', canonical: 'morning', category: 'health' },
  { text: 'Take a photograph a week', target: 52, count: 30, unit: 'photographs', canonical: 'photograph', category: 'creative' },
  { text: 'Learn to sharpen a knife', target: 1, count: 1, category: 'learning' },
  { text: 'Batch cook on Sundays', target: 40, count: 22, unit: 'dishes', canonical: 'dish', category: 'health' },
  { text: 'See a play', target: 4, count: 4, unit: 'plays', canonical: 'play', category: 'creative' },
  { text: 'Swim a kilometre', target: 1, count: 0, category: 'fitness' },
  { text: 'Clear the email backlog', target: 500, count: 380, unit: 'emails', canonical: 'email', category: 'other' },
  { text: 'Try a new recipe a month', target: 12, count: 12, unit: 'dishes', canonical: 'dish', category: 'creative' },
  { text: 'Learn every constellation', target: 12, count: 3, unit: 'constellations', canonical: 'constellation', category: 'learning' },
  { text: 'Fix the bike properly', target: 1, count: 0, category: 'other' },
  { text: 'Give blood', target: 3, count: 2, unit: 'donations', canonical: 'donation', category: 'health' },
  { text: 'Say yes to one thing a month', target: 12, count: 9, unit: 'things', canonical: 'thing', category: 'other' },
];

/** The Managed Member's Board — a nine-year-old's Year, written by a nine-year-old (§4.7). */
const CHILD_BOARD = [
  { text: 'Read a whole chapter book', target: 6, count: 6, unit: 'books', canonical: 'book', category: 'learning' },
  { text: 'Swim a width', target: 10, count: 10, unit: 'widths', canonical: 'width', category: 'fitness' },
  { text: 'Learn to whistle', target: 1, count: 1, category: 'other' },
  { text: 'Ride without stabilisers', target: 1, count: 1, category: 'fitness' },
  { text: 'Make my own breakfast', target: 30, count: 30, unit: 'breakfasts', canonical: 'breakfast', category: 'health' },
  { text: 'Learn ten card tricks', target: 10, count: 4, unit: 'tricks', canonical: 'trick', category: 'creative' },
  { text: 'Feed the cat every day', target: 200, count: 171, unit: 'feeds', canonical: 'feed', category: 'family' },
  { text: 'Draw a comic', target: 12, count: 12, unit: 'comics', canonical: 'comic', category: 'creative' },
  { text: 'Climb the big tree', target: 1, count: 1, category: 'fitness' },
  { text: 'Learn all the capitals', target: 20, count: 8, unit: 'capitals', canonical: 'capital', category: 'learning' },
  { text: 'Beat Dad at chess', target: 1, count: 0, category: 'other' },
  { text: 'Practise the recorder', target: 50, count: 21, unit: 'sessions', canonical: 'session', category: 'creative' },
  CENTRE,
  { text: 'Tidy my room on Fridays', target: 40, count: 26, unit: 'tidies', canonical: 'tidy', category: 'other' },
  { text: 'Grow a sunflower taller than me', target: 1, count: 1, category: 'creative' },
  { text: 'Try a food I do not like', target: 12, count: 7, unit: 'foods', canonical: 'food', category: 'health' },
  { text: 'Learn to tie my laces fast', target: 1, count: 1, category: 'other' },
  { text: 'Walk the dog with Dad', target: 52, count: 33, unit: 'walks', canonical: 'walk', category: 'family' },
  { text: 'Write to my pen pal', target: 6, count: 2, unit: 'letters', canonical: 'letter', category: 'family' },
  { text: 'Learn a whole song', target: 3, count: 0, unit: 'songs', canonical: 'song', category: 'creative' },
  { text: 'Do a cartwheel', target: 1, count: 0, category: 'fitness' },
  { text: 'Save up for the skateboard', target: 20, count: 20, unit: 'pounds', canonical: 'pound', category: 'money' },
  { text: 'Sleep over at Gran’s', target: 4, count: 3, unit: 'sleepovers', canonical: 'sleepover', category: 'family' },
  { text: 'Learn to skip fifty times', target: 50, count: 50, unit: 'skips', canonical: 'skip', category: 'fitness' },
  { text: 'Find a fossil', target: 1, count: 0, category: 'learning' },
];

/**
 * The late joiner's Board (§21). Approved in July, so it seals in July and everything on it
 * happens in the back half of the Year — which is what makes the "joined July" marker and
 * §21.5's "no proration, no special-casing" legible rather than theoretical.
 */
const LATE_BOARD = [
  { text: 'Run the park course', target: 20, count: 14, unit: 'runs', canonical: 'run', category: 'fitness' },
  { text: 'Read the pile by the bed', target: 8, count: 8, unit: 'books', canonical: 'book', category: 'learning' },
  { text: 'Swim on Saturdays', target: 20, count: 11, unit: 'swims', canonical: 'swim', category: 'fitness' },
  { text: 'Learn to make pasta', target: 6, count: 6, unit: 'dishes', canonical: 'dish', category: 'creative' },
  { text: 'Ring my brother', target: 24, count: 19, unit: 'calls', canonical: 'call', category: 'family' },
  { text: 'Walk somewhere new', target: 20, count: 20, unit: 'walks', canonical: 'walk', category: 'health' },
  { text: 'Finish the quilt', target: 10, count: 6, unit: 'panels', canonical: 'panel', category: 'creative' },
  { text: 'Save something every payday', target: 6, count: 6, unit: 'payments', canonical: 'payment', category: 'money' },
  { text: 'Learn twenty chords', target: 20, count: 5, unit: 'chords', canonical: 'chord', category: 'learning' },
  { text: 'Cold water, once a week', target: 20, count: 9, unit: 'dips', canonical: 'dip', category: 'health' },
  { text: 'Cook for the family', target: 12, count: 12, unit: 'dinners', canonical: 'dinner', category: 'family' },
  { text: 'Get the bike back on the road', target: 1, count: 1, category: 'other' },
  CENTRE,
  { text: 'Write every morning', target: 100, count: 61, unit: 'pages', canonical: 'page', category: 'creative' },
  { text: 'See the sea', target: 4, count: 4, unit: 'trips', canonical: 'trip', category: 'family' },
  { text: 'Sort the paperwork', target: 1, count: 0, category: 'money' },
  { text: 'Stretch before bed', target: 100, count: 44, unit: 'stretches', canonical: 'stretch', category: 'health' },
  { text: 'Learn the neighbours’ names', target: 8, count: 8, unit: 'neighbours', canonical: 'neighbour', category: 'family' },
  { text: 'Try a new coffee place', target: 10, count: 7, unit: 'places', canonical: 'place', category: 'other' },
  { text: 'Plant bulbs for spring', target: 50, count: 50, unit: 'bulbs', canonical: 'bulb', category: 'creative' },
  { text: 'Learn to reverse park', target: 1, count: 0, category: 'other' },
  { text: 'Watch every film on the list', target: 12, count: 5, unit: 'films', canonical: 'film', category: 'other' },
  { text: 'Give something away each week', target: 20, count: 16, unit: 'things', canonical: 'thing', category: 'other' },
  { text: 'Take the stairs', target: 100, count: 88, unit: 'climbs', canonical: 'climb', category: 'fitness' },
  { text: 'Say the thing out loud', target: 5, count: 2, unit: 'times', canonical: 'time', category: 'other' },
];

/**
 * Notes, hung on particular Increments (§11.1 — a note is always optional, never required).
 *
 * Keyed by board and position, and applied to a *particular* one of that Tile's Increments
 * rather than to all of them, because a Goal with two hundred identical notes reads as
 * generated data, which is exactly what it would be.
 */
const NOTES = [
  { board: 'demo', position: 0, nth: 3, text: 'Did it. Had to stop counting lengths and just swim.' },
  { board: 'demo', position: 3, nth: 11, text: 'She told the story about the bus again. Still funny.' },
  { board: 'demo', position: 10, nth: 199, text: 'Two hundred. The dog has no idea.' },
  { board: 'demo', position: 7, nth: 89, text: 'Got through the whole piece without looking down.' },
  { board: 'demo', position: 19, nth: 429, text: 'Ordered coffee in Portuguese and was understood.' },
  { board: 'demo', position: 23, nth: 24, text: 'Four degrees. Shorter than I meant it to be.' },
  { board: 'organizer', position: 0, nth: 11, text: 'December sea. Never doing that again — see you next month.' },
  { board: 'organizer', position: 3, nth: 51, text: 'Fifty-two weeks of Mum.' },
  { board: 'child', position: 3, nth: 0, text: 'I did it and I did not even fall off!!' },
  { board: 'child', position: 14, nth: 0, text: 'It is taller than me now. Dad measured.' },
  { board: 'late', position: 5, nth: 19, text: 'Twenty walks since July. Found the reservoir path.' },
  { board: 'late', position: 19, nth: 49, text: 'All fifty in. Ask me again in March.' },
];

/**
 * The Swap (§4.4). Three per Member per Year, and this spends one of the demo Member's.
 *
 * A lowered Target, which is the version worth showing: §4.4 is explicit that raising a
 * Target is free and is not a Swap, so the interesting case is the one that costs. The
 * Increments already logged are untouched and still count (§18.6) — the whole point of the
 * Revision is that the record is never rewritten.
 */
const SWAP = {
  position: 23,
  beforeText: 'A hundred cold swims',
  beforeTarget: 100,
  afterText: 'Sixty cold swims',
  afterTarget: 60,
  /** Month index (0–11) the Swap happened in. */
  month: 8,
};

// ---------------------------------------------------------------------------------------
// Talking to Postgres
// ---------------------------------------------------------------------------------------

/**
 * Everything below runs as `postgres`, not as `service_role`, and that is not laziness.
 *
 * `20260801000024_service_role_grants.sql` grants that role "the grants the Edge Functions
 * need, and not one more" — no INSERT on `members`, `boards`, `tiles`, `goals` or
 * `increments`. Widening it so a seed script could use the REST API would hand the one
 * identity that bypasses the Family boundary (ADR-0004) write access to every table in the
 * schema, permanently, to make one script shorter.
 *
 * So the SQL goes down a database connection. Locally that is the stack's own container;
 * against the live project it is `DEMO_DB_URL` — the session pooler string, the same one
 * `backup.yml` uses, because the direct host is IPv6-only.
 */
const remoteDbUrl = process.env.DEMO_DB_URL;

const localStatus = () =>
  JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }));

const dockerDbContainer = () => {
  try {
    return execFileSync(
      'docker',
      ['ps', '--format', '{{.Names}}', '--filter', 'name=supabase_db'],
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean)[0];
  } catch {
    return undefined;
  }
};

/**
 * Pick a `psql`. There is no `psql` on the machine this was written on, and asking an
 * operator to install Postgres to reseed a demo is a step that will not get taken — so the
 * client comes out of the container the local stack is already running, pointed at whichever
 * server is wanted. `psql` on the PATH is used if it is there.
 */
const psql = (() => {
  const container = dockerDbContainer();
  const target = remoteDbUrl === undefined ? ['-U', 'postgres'] : [remoteDbUrl];
  if (container !== undefined) {
    return (args, input) =>
      execFileSync('docker', ['exec', '-i', container, 'psql', ...target, ...args], {
        encoding: 'utf8',
        input,
      });
  }
  return (args, input) =>
    execFileSync('psql', [...target, ...args], { encoding: 'utf8', input });
})();

/** One statement, one answer. `-q` matters: without it the command tag joins the value. */
const sql = (statement) =>
  psql(['-tAXq', '-v', 'ON_ERROR_STOP=1', '-c', statement]).trim();

/** A whole script, in one transaction, in one round trip. */
const script = (body) =>
  psql(['-XAq', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], body);

/** Postgres string literal escaping. Every value below is authored here, but say it once. */
const q = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`);

// ---------------------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------------------

/**
 * Which Year the demo is.
 *
 * **The one that has finished**, always — a Year cannot be frozen before it has ended
 * without the Wrapped it generates describing a year that is still happening, and §20.1's
 * whole meaning is that the Year is over. `relevantYear()` (src/domain/year.ts) picks "the
 * most recent Year that has passed" when there is no current one, so the demo Family's
 * single Year is what every screen resolves to for the whole of the next calendar year.
 */
const DEMO_YEAR = new Date().getUTCFullYear() - 1;

const iso = (d) => d.toISOString();
/** A UTC instant inside the demo Year. The Family is in London; an hour either way is noise. */
const at = (month, day, hour = 9) => new Date(Date.UTC(DEMO_YEAR, month, day, hour, 0, 0));
const beforeTheYear = (month, day) => new Date(Date.UTC(DEMO_YEAR - 1, month, day, 12, 0, 0));

const SEALED_AT = new Date(Date.UTC(DEMO_YEAR, 0, 1, 0, 0, 0));
const FROZE_AT = new Date(Date.UTC(DEMO_YEAR, 11, 31, 23, 59, 59));
const SETUP_DEADLINE = SEALED_AT;
const FAMILY_CREATED = beforeTheYear(10, 2);
const LATE_JOINED_AT = at(6, 14, 10);
const LATE_SEALED_AT = at(6, 21, 10);

/**
 * When each of a Tile's Increments happened.
 *
 * Spread evenly between the Board's seal and the last day of the Year, with a fixed
 * pseudo-random jitter so the Feed does not read as a metronome. Deterministic on purpose:
 * two runs of this script produce the same demo, which is what makes a screen recording of
 * it still true a month later.
 *
 * The instants matter beyond the Feed. `stamp_increment()` refuses anything before the
 * seal (§11.5), Wrapped's "best month" and "longest-running Goal" are computed from
 * `occurred_at`, and a whole year of Increments landing in one minute would make every
 * Award meaningless.
 */
const occurrences = (count, from, to, salt) => {
  const start = from.getTime();
  const span = to.getTime() - start;
  const out = [];
  for (let n = 0; n < count; n += 1) {
    const base = start + (span * (n + 0.5)) / count;
    // A cheap deterministic hash. Not randomness — repeatability with texture.
    const jitter = (((n + 1) * (salt + 7919)) % 1000) / 1000 - 0.5;
    const spread = Math.min(span / count, 3 * 24 * 3600 * 1000) * jitter;
    out.push(new Date(Math.round(base + spread)));
  }
  return out;
};

// ---------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------

const api = remoteDbUrl === undefined ? undefined : process.env.SUPABASE_URL;
const serviceKey =
  remoteDbUrl === undefined ? undefined : process.env.SUPABASE_SERVICE_ROLE_KEY;

const resolved = (() => {
  if (remoteDbUrl === undefined) {
    const status = localStatus();
    return { api: status.API_URL, serviceKey: status.SERVICE_ROLE_KEY };
  }
  if (api === undefined || serviceKey === undefined) {
    throw new Error('DEMO_DB_URL is set, so SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be too');
  }
  return { api, serviceKey };
})();

const admin = (path, init = {}) =>
  fetch(`${resolved.api}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: resolved.serviceKey,
      Authorization: `Bearer ${resolved.serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const deleteAccountsFor = async (email) => {
  const found = await admin(`users?filter=${encodeURIComponent(email)}`).then((r) => r.json());
  for (const user of found.users ?? []) {
    if ((user.email ?? '').toLowerCase() !== email) continue;
    await admin(`users/${user.id}`, { method: 'DELETE' });
  }
};

const createAccount = async (email, fullName) => {
  const created = await admin('users', {
    method: 'POST',
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: fullName } }),
  });
  if (!created.ok) throw new Error(`${email}: ${await created.text()}`);
  return (await created.json()).id;
};

// ---------------------------------------------------------------------------------------
// Building it
// ---------------------------------------------------------------------------------------

const id = () => randomUUID();

const buildBoard = (key, spec, memberId, sealedAt, joinedLateAt) => {
  const boardId = id();
  const statements = [];
  const increments = [];

  statements.push(
    `insert into boards (id, member_id, year_id, sealed_at, joined_late_at, personal_setup_deadline)
     values (${q(boardId)}, ${q(memberId)}, :year, ${q(iso(sealedAt))},
             ${joinedLateAt === null ? 'null' : q(iso(joinedLateAt))},
             ${joinedLateAt === null ? 'null' : q(iso(new Date(joinedLateAt.getTime() + 7 * 86400000)))});`,
  );

  spec.forEach((tile, position) => {
    const tileId = id();
    if (tile === CENTRE) {
      statements.push(
        `insert into tiles (id, board_id, position, family_goal_id)
         values (${q(tileId)}, ${q(boardId)}, ${position}, :familyGoal);`,
      );
      return;
    }
    const goalId = id();
    statements.push(
      `insert into goals (id, text, target, unit, unit_canonical, category, pace_hint, sharpened_at)
       values (${q(goalId)}, ${q(tile.text)}, ${tile.target}, ${q(tile.unit ?? null)},
               ${q(tile.canonical ?? null)}, ${q(tile.category ?? null)},
               ${q(paceHint(tile))}, ${q(iso(beforeTheYear(11, 12)))});`,
      `insert into tiles (id, board_id, position, goal_id)
       values (${q(tileId)}, ${q(boardId)}, ${position}, ${q(goalId)});`,
    );
    if (tile.count > 0) {
      increments.push({ key, position, tileId, memberId, count: tile.count, sealedAt });
    }
  });

  return { boardId, statements, increments };
};

/** Display-only text (§6.3 — nothing may branch on it), so a plain sentence is enough. */
const paceHint = (tile) => {
  if (tile.target <= 1) return null;
  const perMonth = Math.round(tile.target / 12);
  if (perMonth >= 2) return `about ${perMonth} a month`;
  return tile.target <= 12 ? `about one a month` : `about ${Math.round(tile.target / 52)} a week`;
};

const main = async () => {
  // ---------------------------------------------------------------------------------
  // Teardown. Whole, not partial: the demo is replaced, never merged into.
  // ---------------------------------------------------------------------------------
  //
  // The `demo_account` row goes first. It is what `refuse_demo_write()` consults, and
  // although `auth.uid()` is NULL down this connection and the guard therefore never
  // fires, leaving a marker pointing at an Account that is about to be deleted is the kind
  // of half-state that is only ever noticed later.
  sql('delete from demo_account');
  sql(`delete from families where name = ${q(FAMILY_NAME)}`);
  for (const email of [DEMO_ACCOUNT_EMAIL, ORGANIZER_EMAIL, LATE_JOINER_EMAIL]) {
    await deleteAccountsFor(email);
  }

  // Invite-only sign-up (20260801000037) gates every identity GoTrue creates, including one
  // made through the admin API — the migration's own comment says so, and the two paths are
  // byte-identical at the database. So the operator adds the address first. That is not a
  // workaround; it is what invite-only means.
  for (const [email, note] of [
    [DEMO_ACCOUNT_EMAIL, 'the public demo account'],
    [ORGANIZER_EMAIL, 'demo family — organizer'],
    [LATE_JOINER_EMAIL, 'demo family — late joiner'],
  ]) {
    sql(
      `insert into signup_allowlist (email, note) values (${q(email)}, ${q(note)})
       on conflict (email) do nothing`,
    );
  }

  const demoAccountId = await createAccount(DEMO_ACCOUNT_EMAIL, 'Sam');
  const organizerAccountId = await createAccount(ORGANIZER_EMAIL, 'Nadia');
  const lateAccountId = await createAccount(LATE_JOINER_EMAIL, 'Priya');

  // Only the demo address stays on the allowlist. The other two are on it for exactly as
  // long as it takes GoTrue to create the identity — an allowlist is a list of people who
  // may make an Account, and these two already have one they can never sign in to.
  for (const email of [ORGANIZER_EMAIL, LATE_JOINER_EMAIL]) {
    sql(`delete from signup_allowlist where email = ${q(email)}`);
  }

  const familyId = id();
  const yearId = id();
  const familyGoalId = id();
  const modeVoteId = id();
  const goalVoteId = id();
  const winningProposalId = id();
  const runnerUpProposalId = id();

  const demoMemberId = id();
  const organizerMemberId = id();
  const childMemberId = id();
  const lateMemberId = id();

  const boards = [
    buildBoard('demo', DEMO_BOARD, demoMemberId, SEALED_AT, null),
    buildBoard('organizer', ORGANIZER_BOARD, organizerMemberId, SEALED_AT, null),
    buildBoard('child', CHILD_BOARD, childMemberId, SEALED_AT, null),
    buildBoard('late', LATE_BOARD, lateMemberId, LATE_SEALED_AT, LATE_JOINED_AT),
  ];

  const lines = [];
  const push = (statement) => lines.push(statement);

  push(`insert into families (id, name, timezone, created_at)
        values (${q(familyId)}, ${q(FAMILY_NAME)}, ${q(TIMEZONE)}, ${q(iso(FAMILY_CREATED))});`);

  // The demo Member is deliberately NOT the Organizer.
  //
  // This is the single cheapest containment in the whole feature. Inviting, approving,
  // removing a Member, breaking a tied vote and opening next Year from Wrapped's final card
  // are all `is_organizer_of()` — so a visitor holding the demo session is refused every one
  // of them by a check that already existed, and Wrapped's "Ready for next year?" button
  // does not even render (app/year/wrapped.tsx reads the caller's role).
  push(`insert into members (id, family_id, account_id, guardian_account_id, display_name, role, status, joined_at) values
    (${q(organizerMemberId)}, ${q(familyId)}, ${q(organizerAccountId)}, null, 'Nadia', 'organizer', 'active', ${q(iso(FAMILY_CREATED))}),
    (${q(demoMemberId)},      ${q(familyId)}, ${q(demoAccountId)},      null, 'Sam',   'member',    'active', ${q(iso(beforeTheYear(10, 4)))}),
    (${q(childMemberId)},     ${q(familyId)}, null, ${q(organizerAccountId)}, 'Theo',  'member',    'active', ${q(iso(beforeTheYear(10, 9)))}),
    (${q(lateMemberId)},      ${q(familyId)}, ${q(lateAccountId)},      null, 'Priya', 'member',    'active', ${q(iso(LATE_JOINED_AT))});`);

  push(`insert into years (id, family_id, calendar_year, status, center_mode, setup_deadline, sealed_at, created_at)
        values (${q(yearId)}, ${q(familyId)}, ${DEMO_YEAR}, 'active', 'shared',
                ${q(iso(SETUP_DEADLINE))}, ${q(iso(SEALED_AT))}, ${q(iso(FAMILY_CREATED))});`);

  push(`insert into family_goals (id, year_id, text, completed_at, completed_by_member_id)
        values (${q(familyGoalId)}, ${q(yearId)}, 'Eat dinner together every Sunday',
                ${q(iso(at(10, 9, 19)))}, ${q(organizerMemberId)});`);

  // Both Votes, resolved before the seal — which is what puts two `vote_resolved` rows at
  // the bottom of the Feed (20260801000035). The `mode` row reads its outcome off
  // `years.center_mode`, not off `votes.outcome`; the `goal` row reads the Family Goal's own
  // text. Ballots and proposals are here because a resolved vote with nothing behind it is a
  // result nobody cast.
  //
  // **Opened first, resolved at the end**, which is not decoration. `enforce_proposal_rules()`
  // and the Ballot rules beside it refuse a write when `status = 'resolved' or now() >=
  // closes_at` (20260801000015) — and this Year closed last December, so every Proposal and
  // Ballot below would be refused as "the Setup Window has closed" if the Vote arrived in its
  // final state. Both predicates read the `votes` row and nothing else, so the Setup Window is
  // held open for exactly as long as it takes to fill it and is then closed to its real dates.
  push(`insert into votes (id, year_id, kind, status, closes_at) values
    (${q(modeVoteId)}, ${q(yearId)}, 'mode', 'open', ${q(iso(new Date(Date.now() + 86400000)))}),
    (${q(goalVoteId)}, ${q(yearId)}, 'goal', 'open', ${q(iso(new Date(Date.now() + 86400000)))});`);

  push(`insert into proposals (id, vote_id, member_id, text, created_at) values
    (${q(winningProposalId)},  ${q(goalVoteId)}, ${q(organizerMemberId)}, 'Eat dinner together every Sunday', ${q(iso(beforeTheYear(11, 14)))}),
    (${q(runnerUpProposalId)}, ${q(goalVoteId)}, ${q(demoMemberId)},      'One long walk a month, all of us', ${q(iso(beforeTheYear(11, 16)))});`);

  push(`insert into ballots (vote_id, member_id, choice_mode, proposal_id, updated_at) values
    (${q(modeVoteId)}, ${q(organizerMemberId)}, 'shared', null, ${q(iso(beforeTheYear(11, 18)))}),
    (${q(modeVoteId)}, ${q(demoMemberId)},      'shared', null, ${q(iso(beforeTheYear(11, 18)))}),
    (${q(modeVoteId)}, ${q(childMemberId)},     'shared', null, ${q(iso(beforeTheYear(11, 19)))}),
    (${q(goalVoteId)}, ${q(organizerMemberId)}, null, ${q(winningProposalId)},  ${q(iso(beforeTheYear(11, 24)))}),
    (${q(goalVoteId)}, ${q(demoMemberId)},      null, ${q(winningProposalId)},  ${q(iso(beforeTheYear(11, 25)))}),
    (${q(goalVoteId)}, ${q(childMemberId)},     null, ${q(runnerUpProposalId)}, ${q(iso(beforeTheYear(11, 26)))});`);

  // Now close both Votes to the dates they really had. `outcome` for a `goal` Vote is the
  // winning Proposal's id as text (20260801000015); for a `mode` Vote it is the mode itself.
  push(`update votes set status = 'resolved',
                         closes_at = ${q(iso(SETUP_DEADLINE))},
                         outcome = case kind when 'mode' then 'shared' else ${q(winningProposalId)} end,
                         resolved_at = (case kind when 'mode'
                           then ${q(iso(beforeTheYear(11, 20)))}
                           else ${q(iso(beforeTheYear(11, 27)))} end)::timestamptz
                   where year_id = ${q(yearId)};`);

  for (const board of boards) {
    for (const statement of board.statements) {
      push(statement.replaceAll(':year', q(yearId)).replaceAll(':familyGoal', q(familyGoalId)));
    }
  }

  // ---------------------------------------------------------------------------------
  // A year of Increments.
  //
  // `stamp_increment()` (20260801000018) overwrites `created_at` with `now()` on every
  // insert and cannot be told otherwise — it is a BEFORE INSERT trigger and there is no way
  // through it. The Feed pages on `(created_at, id)`, so left alone every one of these
  // would arrive at the same instant and a year of a Family's life would render as one
  // screen of simultaneous events.
  //
  // So the timestamps are corrected afterwards, in one UPDATE. The trigger is INSERT-only,
  // which is what makes that possible, and `occurred_at` — which it does respect, as long
  // as nothing predates the seal — is what carries the real dates in.
  // ---------------------------------------------------------------------------------
  let increments = 0;
  const noteFor = (key, position, nth) =>
    NOTES.find((n) => n.board === key && n.position === position && n.nth === nth)?.text ?? null;

  for (const board of boards) {
    for (const tile of board.increments) {
      const when = occurrences(
        tile.count,
        tile.sealedAt,
        new Date(Date.UTC(DEMO_YEAR, 11, 30, 20, 0, 0)),
        tile.position * 31 + tile.key.length,
      );
      const values = when
        .map((instant, n) => {
          const note = noteFor(tile.key, tile.position, n);
          return `(gen_random_uuid(), ${q(tile.tileId)}, ${q(tile.memberId)}, ${q(iso(instant))}, ${q(note)})`;
        })
        .join(',\n    ');
      push(`insert into increments (id, tile_id, member_id, occurred_at, note) values\n    ${values};`);
      increments += tile.count;
    }
  }

  script(lines.join('\n'));

  // The Swap, written straight into `revisions` rather than through `swap_tile()`.
  //
  // `swap_tile()` starts by checking `controlled_member_ids()`, which is built from
  // `auth.uid()` — NULL down this connection, so it would answer "that is not your Board"
  // for every Board there is. The row is what the Feed and §4.4's budget actually read, and
  // `revisions_bump_swaps_used` still spends the Swap, so nothing about the result differs.
  const demoBoard = boards[0];
  sql(`insert into revisions (board_id, tile_id, before_text, before_target, after_text, after_target, created_at)
       select ${q(demoBoard.boardId)}, t.id, ${q(SWAP.beforeText)}, ${SWAP.beforeTarget},
              ${q(SWAP.afterText)}, ${SWAP.afterTarget}, ${q(iso(at(SWAP.month, 12, 18)))}
         from tiles t where t.board_id = ${q(demoBoard.boardId)} and t.position = ${SWAP.position}`);

  // Put the Feed back in chronological order. Both of these are columns a trigger stamped
  // with `now()`; both are INSERT-time stamps on tables nothing updates afterwards.
  sql(`update increments i set created_at = i.occurred_at
        from tiles t, boards b
       where t.id = i.tile_id and b.id = t.board_id and b.year_id = ${q(yearId)}`);

  // A Milestone happened when the Increment that caused it happened, not when this script
  // ran. Tile completions take the last Increment on that Tile; a Line takes the last
  // Increment on any Tile in it, which is by definition the tap that closed it.
  sql(`update milestones m set created_at = latest.when
        from (select mm.id,
                     (select max(i.occurred_at) from increments i where i.tile_id = mm.tile_id) as when
                from milestones mm where mm.year_id = ${q(yearId)} and mm.tile_id is not null) latest
       where m.id = latest.id and latest.when is not null`);
  sql(`update milestones m set created_at = coalesce(
          (select max(i.occurred_at)
             from increments i
             join tiles t on t.id = i.tile_id
             join boards b on b.id = t.board_id
            where b.member_id = m.member_id and b.year_id = m.year_id), m.created_at)
       where m.year_id = ${q(yearId)} and m.tile_id is null`);

  // §20.1's freeze, through the function that does it in production. `freeze_year()` is
  // idempotent and has no clock check of its own — the clock lives in `freeze_due_years()`,
  // the hourly sweep — so a Year that has genuinely ended can be frozen the moment it is
  // seeded.
  sql(`select freeze_year(${q(yearId)})`);
  // Materialised once, exactly as §20.2 requires. The Awards are not written here; see
  // below.
  sql(`select generate_wrapped(${q(yearId)})`);

  sql(`insert into demo_account (id, account_id) values (true, ${q(demoAccountId)})
       on conflict (id) do update set account_id = excluded.account_id, updated_at = now()`);

  // The Awards come from the real code path or not at all.
  //
  // `assignAwards()` lives in `src/domain/awards.ts` and is called by the `wrap` Edge
  // Function — including §20.7's rule that every Member receives at least one, which is the
  // part most worth not reimplementing. So this asks that function to run rather than
  // computing anything. If it is not reachable (no `functions serve` locally, say), the
  // hourly `finalize-wrapped` cron job does exactly the same thing within the hour, and
  // `finalize_wrapped()`'s own floor gives every Member with a Board an Award regardless.
  let awards = 'not run';
  try {
    const response = await fetch(`${resolved.api}/functions/v1/wrap`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolved.serviceKey}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    awards = response.ok ? await response.text() : `HTTP ${response.status}`;
  } catch (e) {
    awards = `unreachable (${e.message}) — the hourly finalize-wrapped job will do it`;
  }

  const counts = JSON.parse(
    sql(`select json_build_object(
           'members',    (select count(*) from members where family_id = ${q(familyId)}),
           'increments', (select count(*) from increments i join tiles t on t.id = i.tile_id
                            join boards b on b.id = t.board_id where b.year_id = ${q(yearId)}),
           'milestones', (select count(*) from milestones where year_id = ${q(yearId)}),
           'awards',     (select count(*) from wrapped_awards a
                            join wrapped w on w.id = a.wrapped_id where w.year_id = ${q(yearId)}),
           'feed',       (select count(*) from feed where year_id = ${q(yearId)})
         )::text`),
  );

  console.log(
    JSON.stringify(
      {
        family: FAMILY_NAME,
        year: DEMO_YEAR,
        demoAccount: DEMO_ACCOUNT_EMAIL,
        boardForTheVisitor: `/board/${boards[0].boardId}`,
        seeded: { ...counts, incrementsWritten: increments },
        wrap: awards,
      },
      null,
      2,
    ),
  );
};

await main();
