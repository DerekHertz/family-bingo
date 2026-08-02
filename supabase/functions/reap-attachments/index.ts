/**
 * Slice 16 — §16.6, the half Postgres is not allowed to do.
 *
 * "Deleting an Increment deletes its Attachment from Storage, not just the row." The
 * database records that a removal is owed, in the same commit as the Attachment going
 * away (`orphaned_objects`, 20260801000023_attachment_lifecycle.sql). It cannot do the
 * removal itself: `storage.protect_delete()` is a BEFORE DELETE trigger Supabase installs
 * on `storage.objects` and it raises for everyone, superuser included — "Direct deletion
 * from storage tables is not allowed. Use the Storage API instead."
 *
 * So this speaks the Storage API. It is the only thing standing between a Member
 * believing they deleted a photo of their child and that photo still being there
 * (ADR-0005), which is why a failure here is retried rather than swallowed, and why
 * nothing is marked reaped that Storage did not confirm gone.
 *
 * Invoked by `pg_cron` on a short interval. Idempotent and argument-free: an object that
 * is already gone reports as gone, so a double run is a no-op.
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const BATCH = 100;
const MAX_ATTEMPTS = 10;

interface Orphan {
  id: string;
  bucket_id: string;
  object_path: string;
  attempts: number;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data, error } = await db
    .from('orphaned_objects')
    .select('id, bucket_id, object_path, attempts')
    .is('reaped_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('orphaned_at', { ascending: true })
    .limit(BATCH);

  if (error !== null) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const orphans = (data ?? []) as Orphan[];
  if (orphans.length === 0) return Response.json({ reaped: 0, retrying: 0 });

  // Grouped by bucket so each bucket is one remove() call. There is only ever
  // 'attachments' today; grouping means adding a second bucket is not a code change.
  const byBucket = new Map<string, Orphan[]>();
  for (const orphan of orphans) {
    byBucket.set(orphan.bucket_id, [...(byBucket.get(orphan.bucket_id) ?? []), orphan]);
  }

  const reaped: string[] = [];
  const retrying: Orphan[] = [];

  for (const [bucket, group] of byBucket) {
    const { error: removeError } = await db.storage
      .from(bucket)
      .remove(group.map((o) => o.object_path));

    // remove() does not fail on an object that is already absent, which is what makes a
    // second run safe. It fails on the things worth retrying: the network, and Storage
    // being unavailable.
    if (removeError === null) {
      reaped.push(...group.map((o) => o.id));
    } else {
      retrying.push(...group);
    }
  }

  if (reaped.length > 0) {
    await db.from('orphaned_objects')
      .update({ reaped_at: new Date().toISOString() })
      .in('id', reaped);
  }

  // Counted, never abandoned quietly. A row that exhausts MAX_ATTEMPTS stops being
  // retried but stays unreaped, so it shows up in any "what is still owed" query rather
  // than looking done.
  for (const orphan of retrying) {
    await db.from('orphaned_objects')
      .update({ attempts: orphan.attempts + 1 })
      .eq('id', orphan.id);
  }

  return Response.json({ reaped: reaped.length, retrying: retrying.length });
});
