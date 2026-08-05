/**
 * Attachments — putting a photo somewhere private, and getting a URL back (PRD §16).
 *
 * > **Given** a Member logging an Increment **When** they attach a photo **Then** it
 * > uploads to Supabase Storage, appears in the Family Feed, and is **unreadable** by any
 * > Account outside the Family — including by direct URL.
 *
 * Three facts about the bucket, all of them load-bearing and none of them the client's to
 * decide (`20260801000006_storage.sql`, `20260801000023_attachment_lifecycle.sql`):
 *
 *   - It is **private**. There is no public URL and `getPublicUrl` is not called anywhere
 *     in this app; the only way to the bytes is a signed URL with a short TTL (§16.2).
 *   - The object key is `{family_id}/{increment_id}`, and the three Storage policies all
 *     read `safe_uuid((storage.foldername(name))[1]) in (select visible_family_ids())`.
 *     The Family segment *is* the boundary, which is why the path is built in
 *     `src/domain/attachment.ts` from the two ids and never assembled by hand here.
 *   - `attachments_enforce_path` raises `42501` for any row whose `storage_path` does not
 *     name its own Increment inside its own Family. Not because the bytes would leak —
 *     Storage RLS still refuses those — but because `attachment_path` is handed to the
 *     client to sign, and a row pointing at another Family's object would get their path
 *     rendered inside this Family's Feed.
 *
 * **Nothing in this file calls `storage.remove()`, and that is §16.6 being satisfied
 * rather than ignored.** Deleting an Increment cascades to its `attachments` row
 * (`increment_id … on delete cascade`), the `attachments_orphan_object` trigger records
 * the owed removal in `orphaned_objects` in that same commit, and the `reap-attachments`
 * Edge Function removes the bytes through the Storage API on a `pg_cron` schedule.
 * Postgres cannot do it itself — `storage.protect_delete()` refuses everyone, superuser
 * included. A client-side `remove()` alongside the row delete would be a second, racing
 * deleter with no transaction around it: if it ran and the row delete did not, the Feed
 * would hand out a path with no bytes behind it; if it failed and the row delete
 * succeeded, the reaper would do it anyway.
 *
 * `attachPhoto` used to be the one exception. It is not any more, and the reason is the
 * whole of the note above it.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  SIGNED_URL_REFRESH_MS,
  SIGNED_URL_TTL_SECONDS,
  attachmentPath,
} from '../../src/domain/attachment';
import { failure } from '../failure';
import { supabase } from '../supabase';
import type { PickedPhoto } from '../photo';

const BUCKET = 'attachments';

/** `unique_violation` — the Attachment row is already there under this Increment. */
const ALREADY_THERE = '23505';

/**
 * Storage speaks HTTP rather than SQLSTATE, so its "already exists" arrives as a 409 in a
 * `statusCode` field that is a *string*. Read defensively: this is the one branch that
 * turns a retried upload into a success, and getting it wrong turns it into a lost photo.
 */
const isDuplicateObject = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const shape = error as { statusCode?: unknown; status?: unknown; error?: unknown };
  return (
    String(shape.statusCode ?? '') === '409' ||
    shape.status === 409 ||
    String(shape.error ?? '') === 'Duplicate'
  );
};

export interface AttachPhoto {
  familyId: string;
  incrementId: string;
  photo: PickedPhoto;
}

/**
 * Write the row that points at the bytes, then put the bytes there.
 *
 * **The order, and why this one.** Three things have to happen and they cannot be one
 * transaction, because one of them is not in Postgres at all:
 *
 *   1. the Increment row (`useLogIncrement` — it has to be first regardless, since
 *      `attachments.increment_id` is a foreign key and `attachments_own_insert` checks
 *      the Increment's Member),
 *   2. the `attachments` row,
 *   3. the object.
 *
 * Given 1, the choice is whether 2 comes before or after 3, and both orders can break.
 * **This was object-first and has been reversed**, because object-first has a failure the
 * ADR names outright and row-first does not:
 *
 *   - **Object first.** The compensating `remove()` only ran when the insert *returned an
 *     error*. It could not run when the JavaScript never reached the insert at all: a slow
 *     upload on a train, the Member switching apps, iOS terminating the process. The
 *     object is then in the bucket and nothing anywhere knows: the Feed LEFT JOINs
 *     `attachments` and never shows it, `orphaned_objects` is written **only** by
 *     `attachments_orphan_object` — an AFTER DELETE trigger on a row that was never
 *     written — so the reaper is never told, nothing sweeps `storage.objects` against
 *     `attachments`, and the next tap mints a fresh uuid so the key is never named again.
 *     A photograph of a child sitting in a bucket that nothing can ever remove, which is
 *     word for word what ADR-0005 calls the worst version of this feature.
 *   - **Row first.** If the upload then fails, or the process dies between the two, the
 *     Feed carries an `attachment_path` for bytes that are not there yet. `<FeedRow>`
 *     already draws that as §3's hatch placeholder — "never a spinner, never a blur-up" —
 *     so it degrades to *the photo is still arriving* rather than to a broken frame. It is
 *     visible, it is bounded, and a Member can clear it by removing the Increment, which
 *     cascades the row and hands anything that did land to the reaper.
 *
 * So: **row first**. The exchange is a wound anybody can see and anybody can undo, in
 * place of one nobody can see and nobody can undo. It also makes the invariant structural
 * rather than compensatory — *every object in the bucket is named by a live `attachments`
 * row, or by an `orphaned_objects` row the reaper owns* — and no interruption anywhere in
 * this function can break it, because the row is written before the bytes exist.
 *
 * The alternative considered and rejected was keeping object-first and adding a
 * service-role sweep: list the bucket hourly, enqueue anything older than an hour with no
 * matching `storage_path`. It needs a migration, a scheduled job, and a heuristic age
 * threshold that races every slow upload — machinery to detect a state this ordering
 * cannot produce.
 *
 * **The compensation is now unconditionally safe, which the old one was not.** Deleting
 * the row on an upload failure fires the orphan trigger, so if the upload's response was
 * merely *lost* and the bytes did land, the reaper collects them; and if the upload really
 * failed, `remove()` in the reaper does not mind an object that is already absent. The old
 * compensation had no such property: postgrest-js reports a lost response as
 * `{status: 0, code: ''}`, indistinguishable from a request that never left, so a
 * committed INSERT whose response was dropped had its object deleted out from under a live
 * row — every Member of the Family served a path with no bytes, forever, with no retry
 * path, while the Member who took the photo was told it had not uploaded.
 *
 * Both steps stay idempotent, because the whole path is derived from the Increment's
 * client-generated uuid (§11.2): a retry inserts the same row and uploads to the same key,
 * and both say "already there" rather than making a second copy.
 */
export const attachPhoto = async ({
  familyId,
  incrementId,
  photo,
}: AttachPhoto): Promise<string> => {
  const path = attachmentPath(familyId, incrementId);

  const { error: rowError } = await supabase.from('attachments').insert({
    increment_id: incrementId,
    storage_path: path,
    // §20.4 counts photos and Wrapped may want the shape of them; they are also the only
    // record of what was uploaded once the bytes are behind a signed URL.
    width: photo.width,
    height: photo.height,
    bytes: photo.bytes,
  });
  // Nothing has been uploaded at this point, so there is nothing to compensate and — the
  // part that matters — nothing that could become an orphan. An ambiguous failure here
  // (a lost response over a committed insert) leaves at worst a row with no bytes, which
  // is the hatch. Uploading anyway to cover that case is what would reintroduce the
  // orphan, because the row may equally not be there.
  if (rowError !== null && failure(rowError).code !== ALREADY_THERE) throw rowError;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, photo.body, {
      contentType: photo.contentType,
      // **Not `upsert: true`.** An upsert issues a PUT, which Storage checks against an
      // UPDATE policy on `storage.objects` — and there is no update policy in
      // `20260801000006_storage.sql`, only select, insert and delete. `upsert: true`
      // would fail for every Member on every photo. A duplicate is handled below instead,
      // which is the honest answer anyway: the object at this key can only ever be this
      // Increment's own photo.
      upsert: false,
    });
  if (uploadError === null || isDuplicateObject(uploadError)) return path;

  // Compensate by withdrawing the row, never by removing the object — see above, and
  // §16.6: the cascade and the reaper own object deletion, and this hands them the job
  // rather than doing it here.
  //
  // `.select()` is not decoration. `attachments_own_delete` is a `using` policy, so a
  // refused DELETE matches nothing and PostgREST answers 204 with **no error object** —
  // the same trap `useDeleteIncrement` documents. Asking for the deleted rows makes an
  // empty result the failure it is.
  const { data: withdrawn, error: withdrawError } = await supabase
    .from('attachments')
    .delete()
    .eq('increment_id', incrementId)
    .select('increment_id');

  // Not swallowed. The old compensation ended in `.catch(() => undefined)`, which was dead
  // code twice over: `remove()` resolves to `{data, error}` rather than rejecting, so the
  // catch never ran, and the `error` it resolved with was discarded unread — the one
  // outcome worth knowing about was the one nothing could see.
  if (withdrawError !== null || (withdrawn ?? []).length === 0) {
    throw new Error(
      'the photo did not upload and its Attachment row could not be withdrawn — the Feed ' +
        `will show the hatch for this Increment until it is deleted (upload: ${
          failure(uploadError).message || 'no message'
        }; withdraw: ${failure(withdrawError).message || 'nothing was deleted'})`,
    );
  }

  throw uploadError;
};

/**
 * Carries the Account, like every key in this directory, and the paths it is about.
 *
 * The paths are part of the key rather than the query's business because a Feed page that
 * grows has a different answer, and because two Accounts on one handset must never share
 * a signed URL: the boundary a signature crosses is the one thing in this app that cannot
 * be undone once it is out.
 */
export const signedPhotosKey = (paths: readonly string[], accountId: string) =>
  ['photo-urls', accountId, paths.join(' ')] as const;

/**
 * Sign a whole screenful at once (§3, `<FeedRow>` — "`<Image>` from a **signed URL with a
 * short TTL**").
 *
 * **One round trip for the page, not one per row.** `createSignedUrls` takes a list, and
 * the alternative — a `createSignedUrl` inside each row — is thirty requests for thirty
 * rows, repeated whenever a row re-renders, on a screen that exists to be scrolled.
 *
 * **And it re-signs while the screen is open.** A signed URL is a stateless HMAC over the
 * path and an expiry; nothing refreshes one and nothing revokes one. A Feed left open on a
 * kitchen table outlives a five-minute URL, and a row scrolling back into view then asks
 * for a URL that has expired — a photo that was there a minute ago and is a grey box now.
 * So the query refetches at `SIGNED_URL_REFRESH_MS`, comfortably inside the TTL, and
 * `keepPreviousData` means a page that grows does not blank the images already on screen
 * while the new batch is signed.
 *
 * `gcTime` is the TTL rather than react-query's five-minute default, so an unmounted
 * screen cannot come back and hand an `<Image>` a URL that expired while it was away.
 *
 * **This query is never written to disk.** `lib/persist-policy.ts` excludes it by name,
 * and §7.6 is why: a signed URL persisted into AsyncStorage is a long-lived URL by another
 * route, readable by anything that can read the file, long after the Member has closed the
 * app.
 */
export function useSignedPhotos(paths: readonly string[], accountId: string | undefined) {
  // Sorted and deduplicated so that the same set of rows is the same key however the page
  // arrived — otherwise scrolling back and forth re-signs an identical list.
  const wanted = [...new Set(paths)].sort();

  return useQuery({
    queryKey: signedPhotosKey(wanted, accountId ?? 'anonymous'),
    enabled: accountId !== undefined && wanted.length > 0,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    // Keep signing while the app is backgrounded? No: nothing is on screen to expire, and
    // the refetch on foreground covers the return.
    refetchIntervalInBackground: false,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls([...wanted], SIGNED_URL_TTL_SECONDS);
      if (error !== null) throw error;

      const urls: Record<string, string> = {};
      for (const signed of data ?? []) {
        // A per-path `error` is not an exception. RLS refusing one object — a Member of
        // two Families scrolling a Feed, a row whose photo the reaper has already taken —
        // must not cost the other twenty-nine rows their images. The path simply has no
        // URL, and `<FeedRow>` renders the placeholder it renders while loading.
        if (signed.error !== null || signed.path === null) continue;
        const url = signed.signedUrl ?? signed.signedURL;
        if (typeof url === 'string' && url !== '') urls[signed.path] = url;
      }
      return urls;
    },
  });
}
