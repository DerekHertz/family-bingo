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

interface PendingRow {
  id: string;
  account_id: string;
  kind: string;
  attempts: number;
  year_id: string | null;
  subject: { display_name: string } | null;
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
    default:
      return { title: 'Family Bingo', body: 'Something happened.' };
  }
};

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

  const { data: pending, error } = await db
    .from('notifications')
    .select('id, account_id, kind, attempts, year_id, subject:subject_member_id (display_name)')
    .is('sent_at', null)
    .is('failed_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(EXPO_BATCH);

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
    rows.filter((r) => r.kind === 'digest' && r.year_id !== null).map((r) => r.year_id!),
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
    .in('account_id', [...new Set(rows.map((r) => r.account_id))]);

  const tokensFor = new Map<string, string[]>();
  for (const { account_id, token } of tokenRows ?? []) {
    tokensFor.set(account_id, [...(tokensFor.get(account_id) ?? []), token]);
  }

  // One message per device. A row addressed to an Account with no registered device is
  // not a failure — they have not granted permission, or have no app installed — so it is
  // marked sent rather than retried. §15.3: notification permission is a one-way door,
  // and nothing here is allowed to treat declining it as an error.
  const messages: { to: string; title: string; body: string; rowId: string }[] = [];
  const noDevice: string[] = [];

  for (const row of rows) {
    const tokens = tokensFor.get(row.account_id) ?? [];
    if (tokens.length === 0) {
      noDevice.push(row.id);
      continue;
    }
    const { title, body } = render(
      row.kind,
      row.subject?.display_name ?? 'Someone',
      row.year_id === null ? undefined : digestFor.get(row.year_id),
    );
    for (const to of tokens) messages.push({ to, title, body, rowId: row.id });
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
        body: JSON.stringify(batch.map(({ to, title, body }) => ({ to, title, body }))),
      });
      const tickets = ((await response.json())?.data ?? []) as ExpoTicket[];

      batch.forEach((message, index) => {
        const ticket = tickets[index];
        if (ticket?.status === 'ok') {
          stamped.add(message.rowId);
          return;
        }
        failed.add(message.rowId);
        // §15.4. The app is gone; the token is not coming back.
        if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(message.to);
      });
    } catch {
      // Network trouble is transient. Leave the rows pending and let the next drain
      // retry them — that is what `attempts` bounds.
      batch.forEach((message) => failed.add(message.rowId));
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
    const row = rows.find((r) => r.id === id);
    const attempts = (row?.attempts ?? 0) + 1;
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
