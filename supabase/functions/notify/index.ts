/**
 * Slice 15 — Push fan-out. The one place this app talks to Expo.
 *
 * §15.4: `expo-notifications` over APNs + FCM. Device tokens live in `device_tokens`,
 * refreshed on launch by the client, and **pruned here on delivery failure** — a token
 * that Expo reports as unregistered belongs to an app that has been deleted, and keeping
 * it means retrying that device forever.
 *
 * This function decides nothing about WHO gets notified. That was decided in the database
 * when the row was written (§15.5, 20260801000022_notifications.sql), because "never
 * notify the Member who caused it" is a rule worth having pgTAP around rather than a
 * filter in a Deno file. All this does is drain, render and send.
 *
 * It decides nothing about WHEN either, for the same reason. `pending_notifications()`
 * (20260801000035) is the drain query, and quiet hours — a wall-clock window in the
 * FAMILY's timezone (FRONTEND_DESIGN §4.8, §8.3 T1) — are applied there. What this file
 * owes quiet hours is the other half of §4.8's sentence: everything held overnight goes
 * out "batched into one line at 07:00", which is a rendering job and belongs here.
 *
 * That same query carries the Board and the Tile a tap has to open. §4.8: "A tap opens the
 * Tile the notification is about, not the app." A message with no `data` payload has
 * nothing to route with, so the app could only ever open its own front door.
 *
 * Invocation is a Supabase Database Webhook on `notifications` insert — that is what
 * makes the acceptance test's "within 30 seconds" true, and it is configured in project
 * settings rather than in a migration. This endpoint is idempotent and takes no
 * arguments, so a cron sweep is a safe backstop: rows already sent are not re-sent.
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

/** Expo's documented ceiling for one push request. */
const EXPO_BATCH = 100;
const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Give up on a row after this many attempts rather than retrying it forever. */
const MAX_ATTEMPTS = 5;

/**
 * One row of `pending_notifications()`. The column names are the function's, and they are
 * prefixed rather than named after the columns they carry — a RETURNS TABLE name that
 * collides with a column in its own FROM list is ambiguous in Postgres.
 */
interface PendingRow {
  notification_id: string;
  recipient_account: string;
  notification_kind: string;
  attempt_count: number;
  about_year: string | null;
  subject_name: string | null;
  route_board: string | null;
  route_tile: string | null;
  was_held: boolean;
}

/**
 * Where a tap lands (§4.8).
 *
 * `tileId` is absent on a Bingo and a Blackout, which carry no Tile (§13.1) — the app
 * opens the Board and shows it whole, which is the true answer rather than a square picked
 * to fill the field.
 */
interface Route {
  boardId: string;
  tileId?: string;
}

/** The week a `digest` row is about (§19.2). Built once per Family, read once per Member. */
interface Digest {
  increment_count: number;
  milestone_count: number;
  notable: { member: string; type: string; goal: string | null }[];
  near_line: { member: string; line_index: number; position: number }[];
}

interface ExpoTicket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

/**
 * The copy. It lives here rather than in the database so that changing what a push says
 * is a deploy, not a migration — the outbox stores facts, not sentences.
 *
 * Every line names the Member rather than the Account, because the Account is not the
 * player (ADR-0003) and a Guardian's own name on their child's Bingo would be wrong.
 */
const render = (
  kind: string,
  who: string,
  digest?: Digest,
): { title: string; body: string } => {
  switch (kind) {
    case 'tile_completed':
      return { title: 'A square just fell', body: `${who} completed a Tile.` };
    case 'bingo':
      return { title: 'Bingo!', body: `${who} completed a Line.` };
    case 'blackout':
      return { title: 'Blackout', body: `${who} completed all 25 Tiles.` };
    case 'join_requested':
      return { title: 'Someone wants to join', body: `${who} is waiting for you to approve them.` };
    case 'join_approved':
      return { title: "You're in", body: 'Your Family approved you. Time to write your Goals.' };
    case 'setup_closing':
      return { title: 'Boards seal tomorrow', body: 'Last chance to finish your 24 Goals.' };
    case 'digest':
      return { title: 'Your week', body: summarise(digest) };
    // The Almanac (§8: "Wrapped" is the codebase's word and nobody else's product's).
    // generate_wrapped() has written this kind since slice 20 and nothing rendered it, so
    // the one notification a Family gets at the end of a Year read "Something happened."
    case 'wrapped':
      return { title: 'The Almanac', body: 'The Year is finished. Every board is in it.' };
    default:
      return { title: 'Family Bingo', body: 'Something happened.' };
  }
};

/** How many of a held night's events are named before the line stops naming them. */
const HELD_NAMES = 3;

/**
 * The night, as one line (§4.8: "batched into one line at 07:00").
 *
 * The alternative — sending eight held pushes the moment the window closes — is the
 * failure quiet hours exist to prevent, moved by ten hours. §15.3's one-way door does not
 * care what time it was.
 *
 * Each phrase still names the Member and the thing, which is §4.8's other rule: never
 * "someone in your family". Beyond three, the count is of other people's news and never of
 * anything the reader has or has not done.
 */
const summariseHeld = (rows: PendingRow[]): { title: string; body: string } => {
  const phrases = rows
    .slice(0, HELD_NAMES)
    .map((row) => render(row.notification_kind, row.subject_name ?? 'Someone').body.replace(/\.$/, ''));
  const rest = rows.length - phrases.length;
  return {
    title: 'Overnight',
    body: `${[...phrases, ...(rest > 0 ? [`and ${rest} more`] : [])].join(' · ')}.`,
  };
};

/** The Board and, where there is one, the square (§4.8). */
const routeOf = (row: PendingRow): Route | undefined =>
  row.route_board === null
    ? undefined
    : { boardId: row.route_board, ...(row.route_tile === null ? {} : { tileId: row.route_tile }) };

/**
 * The Digest's one sentence.
 *
 * A Digest is the only push that is a summary rather than an event, so it is the only one
 * whose copy depends on data. Leads with somebody's name where there is one — "Bob got a
 * Bingo" is a reason to open the app and "41 increments" is a statistic.
 */
const summarise = (digest?: Digest): string => {
  if (digest === undefined) return 'Here is what your Family got up to.';

  const parts: string[] = [];
  if (digest.notable.length > 0) {
    const first = digest.notable[0];
    parts.push(first.type === 'tile_completed'
      ? `${first.member} finished ${first.goal ?? 'a Goal'}`
      : `${first.member} got a ${first.type === 'bingo' ? 'Bingo' : first.type.replace('_', ' ')}`);
  }
  if (digest.increment_count > 0) {
    parts.push(`${digest.increment_count} in all`);
  }
  // The one line worth a nudge: four of five, where nothing else in the app says anything.
  if (digest.near_line.length > 0) {
    const who = digest.near_line[0].member;
    parts.push(`${who} is one Tile from a Line`);
  }
  return parts.length > 0 ? `${parts.join(' · ')}.` : 'Here is what your Family got up to.';
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // An open POST here would let anyone mark the outbox sent, which is a silent way to
  // stop a Family being notified of anything. `sharpen` checks for a bearer token and so
  // does this; the caller is pg_cron or a Database Webhook, both of which send one.
  if (req.headers.get('Authorization') === null) {
    return new Response('unauthorized', { status: 401 });
  }

  // Service role: this reads across every Family by design. It is the one component that
  // does, which is why it is a server function with no client path to it (ADR-0004).
  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Not a select on `notifications` any more. Quiet hours are a send-time decision that
  // needs the Family's timezone, and the route a tap follows is two joins away from the
  // `milestone_id` this row stores — both belong in one query the database can be tested
  // on (20260801000035).
  const { data: pending, error } = await db.rpc('pending_notifications', {
    batch_size: EXPO_BATCH,
    max_attempts: MAX_ATTEMPTS,
  });

  if (error !== null) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (pending ?? []) as unknown as PendingRow[];
  if (rows.length === 0) {
    return Response.json({ drained: 0, sent: 0, pruned: 0 });
  }

  // Digests carry content, unlike every other kind. Fetched per Year rather than per row,
  // because a Family's week is one Digest read by however many Members opted in (§19.1).
  const digestYears = [...new Set(
    rows
      .filter((r) => r.notification_kind === 'digest' && r.about_year !== null)
      .map((r) => r.about_year!),
  )];
  const digestFor = new Map<string, Digest>();
  if (digestYears.length > 0) {
    const { data: digestRows } = await db
      .from('digests')
      .select('year_id, increment_count, milestone_count, notable, near_line')
      .in('year_id', digestYears)
      .order('week_start', { ascending: false });
    for (const row of digestRows ?? []) {
      if (!digestFor.has(row.year_id)) digestFor.set(row.year_id, row as unknown as Digest);
    }
  }

  const { data: tokenRows } = await db
    .from('device_tokens')
    .select('account_id, token')
    .in('account_id', [...new Set(rows.map((r) => r.recipient_account))]);

  const tokensFor = new Map<string, string[]>();
  for (const { account_id, token } of tokenRows ?? []) {
    tokensFor.set(account_id, [...(tokensFor.get(account_id) ?? []), token]);
  }

  // Held rows are grouped by Account so the night can go out as one line (§4.8). Everything
  // else stays one message per row, which is what it has always been: a Tile completing at
  // three in the afternoon is one event and is not batched with anything.
  const byAccount = new Map<string, PendingRow[]>();
  for (const row of rows) {
    byAccount.set(row.recipient_account, [...(byAccount.get(row.recipient_account) ?? []), row]);
  }

  // One message per device. A row addressed to an Account with no registered device is
  // not a failure — they have not granted permission, or have no app installed — so it is
  // marked sent rather than retried. §15.3: notification permission is a one-way door,
  // and nothing here is allowed to treat declining it as an error.
  //
  // `rowIds` is a list rather than an id because a batched line covers a whole night: the
  // rows it summarises are all delivered by it, and all stamped by it.
  const messages: { to: string; title: string; body: string; data?: Route; rowIds: string[] }[] = [];
  const noDevice: string[] = [];

  for (const [account, queued] of byAccount) {
    const tokens = tokensFor.get(account) ?? [];
    if (tokens.length === 0) {
      for (const row of queued) noDevice.push(row.notification_id);
      continue;
    }

    const held = queued.filter((row) => row.was_held);
    // One held row is its own sentence — "Bob completed a Tile" is better than a summary
    // of it — so batching starts at two.
    const batched = held.length > 1 ? held : [];
    const single = held.length > 1 ? queued.filter((row) => !row.was_held) : queued;

    if (batched.length > 0) {
      const { title, body } = summariseHeld(batched);
      // The night's first route. A single tap cannot open four Tiles, and the oldest is the
      // one the line leads with.
      const route = batched.map(routeOf).find((r) => r !== undefined);
      for (const to of tokens) {
        messages.push({
          to,
          title,
          body,
          ...(route === undefined ? {} : { data: route }),
          rowIds: batched.map((row) => row.notification_id),
        });
      }
    }

    for (const row of single) {
      const { title, body } = render(
        row.notification_kind,
        row.subject_name ?? 'Someone',
        row.about_year === null ? undefined : digestFor.get(row.about_year),
      );
      const route = routeOf(row);
      for (const to of tokens) {
        messages.push({
          to,
          title,
          body,
          ...(route === undefined ? {} : { data: route }),
          rowIds: [row.notification_id],
        });
      }
    }
  }

  const stamped = new Set<string>(noDevice);
  const failed = new Set<string>();
  const deadTokens: string[] = [];

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    try {
      const response = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          batch.map(({ to, title, body, data }) => ({ to, title, body, ...(data === undefined ? {} : { data }) })),
        ),
      });
      const tickets = ((await response.json())?.data ?? []) as ExpoTicket[];

      batch.forEach((message, index) => {
        const ticket = tickets[index];
        if (ticket?.status === 'ok') {
          for (const id of message.rowIds) stamped.add(id);
          return;
        }
        for (const id of message.rowIds) failed.add(id);
        // §15.4. The app is gone; the token is not coming back.
        if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(message.to);
      });
    } catch {
      // Network trouble is transient. Leave the rows pending and let the next drain
      // retry them — that is what `attempts` bounds.
      batch.forEach((message) => {
        for (const id of message.rowIds) failed.add(id);
      });
    }
  }

  // A row that reached at least one device counts as delivered, and the code used to say
  // the opposite of its comment: un-stamping on any failure meant the next drain re-pushed
  // to the phone that had already received it. Partial success on a Member with two
  // devices is not worth a duplicate push to the one that worked (§15.3).
  for (const id of stamped) failed.delete(id);

  if (stamped.size > 0) {
    await db.from('notifications')
      .update({ sent_at: new Date().toISOString() })
      .in('id', [...stamped]);
  }

  for (const id of failed) {
    const row = rows.find((r) => r.notification_id === id);
    const attempts = (row?.attempt_count ?? 0) + 1;
    await db.from('notifications')
      .update({ attempts, failed_at: attempts >= MAX_ATTEMPTS ? new Date().toISOString() : null })
      .eq('id', id);
  }

  if (deadTokens.length > 0) {
    await db.from('device_tokens').delete().in('token', deadTokens);
  }

  return Response.json({
    drained: rows.length,
    sent: stamped.size,
    retrying: failed.size,
    pruned: deadTokens.length,
  });
});
