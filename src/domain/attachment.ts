/**
 * Photo Attachments — the path, the size, and the words (PRD §16, ADR-0005).
 *
 * > A photo a Member optionally hangs on an Increment. Visible only to their Family, and
 * > never outside it. (CONTEXT.md)
 *
 * This is the pure half of slice 16: the object key, the downscale arithmetic, and the
 * sentences. The I/O — picking, re-encoding, uploading, signing — is `lib/photo.ts` and
 * `lib/queries/attachments.ts`, because none of that can run in a millisecond test suite
 * and all of this can.
 *
 * **The path is not the client's to invent.** `enforce_attachment_path()` (migration
 * `20260801000023_attachment_lifecycle.sql`) raises `42501` for anything that is not
 * `{family_id}/{increment_id}` with an optional extension after the first `.`. That
 * trigger exists because `storage_path` was free text and a Member could hang a row off
 * their own Increment carrying **another Family's** object path — Storage RLS still
 * refused them the bytes, but the Feed hands `attachment_path` to the client to sign, and
 * a boundary that holds only because the second lock held is not a boundary (ADR-0004).
 * So the path is built here, once, from the two ids the server will check it against.
 *
 * The bucket id is deliberately **not** part of it. `storage.foldername(name)[1]` is the
 * Family segment, and `name` never carries the bucket — a path of
 * `attachments/{family}/{increment}` would put the literal word "attachments" where the
 * Family id is checked, and `safe_uuid()` would answer NULL, which is in nobody's
 * `visible_family_ids()`.
 */

/** §16.4 — "Client-side downscale to max 2048px long edge before upload." */
export const MAX_EDGE = 2048;

/**
 * How long a signed URL lives (§16.2, "signed URLs with a **short** TTL").
 *
 * Five minutes, and the number is a security parameter rather than a performance one.
 * **Nothing revokes a signed URL** — it is a stateless HMAC over the path and an expiry,
 * so Storage never consults a table before honouring one. That is exactly why the TTL is
 * the whole of the exposure window: a URL that leaks into a screenshot, a log, a crash
 * report or a clipboard is readable by anyone holding it until it expires, Family boundary
 * or not.
 *
 * Five rather than sixty: an hour is long enough for a URL to be pasted somewhere and
 * still work, and a Feed row does not need an hour — it needs long enough to load a 150pt
 * image and to survive a scroll back up. It is also why §16.6's delete is safe enough:
 * the reaper removes the bytes moments after the row goes, and any URL minted before that
 * outlives the row by at most this.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * When to mint a fresh batch, in milliseconds.
 *
 * A Feed left open on a table outlives a five-minute URL, and a row scrolling back into
 * view then re-requests an expired one — which renders as a photo that was there a minute
 * ago and is now a grey box. Refreshing at two minutes leaves three minutes of slack for
 * a slow network, and the cost of being wrong in this direction is one extra round trip.
 */
export const SIGNED_URL_REFRESH_MS = 120_000;

/**
 * Every Attachment is re-encoded to JPEG on the way out, whatever arrived.
 *
 * Not for the bytes — for the **EXIF**. A photo out of a phone's library carries the
 * capture timestamp, the device, and very often GPS coordinates: the home a photograph of
 * a child was taken in. §8.1 says nothing crosses a Family boundary, and inside the
 * boundary a Family already knows where they live — but the coordinates would sit in the
 * bucket forever, in a file the app can hand out a URL to, for no benefit at all.
 * `expo-image-manipulator` writes a fresh file from decoded pixels and carries none of it
 * across, so re-encoding unconditionally — even for an image already under `MAX_EDGE` —
 * is the cheapest way to be sure. `expo-image-picker` is asked for `exif: false` too;
 * this is the belt to that brace.
 */
export const PHOTO_EXTENSION = 'jpg';
export const PHOTO_CONTENT_TYPE = 'image/jpeg';

/**
 * JPEG quality for the re-encode.
 *
 * 0.7 at 2048px is around 300–500 KB for a phone photograph — small enough to upload on a
 * bad connection, and far past the point where a 150pt Feed image or a full-screen look at
 * it shows any difference.
 */
export const PHOTO_QUALITY = 0.7;

/**
 * The object key, exactly as `enforce_attachment_path()` will recompute it.
 *
 * `{family_id}/{increment_id}.jpg`. The Increment id is the client-generated uuid of
 * §11.2, which is what lets the path be known **before** the row is written — the tap, the
 * object and the Attachment row all name the same id, and none of them has to wait for a
 * server to allocate one.
 */
export const attachmentPath = (familyId: string, incrementId: string): string =>
  `${familyId}/${incrementId}.${PHOTO_EXTENSION}`;

/** The Family segment of an object key, or `null` if it does not have one. */
export const familyOfPath = (path: string): string | null => {
  const [family, ...rest] = path.split('/');
  return rest.length === 0 || family === undefined || family === '' ? null : family;
};

/**
 * What to ask the manipulator to resize to, or `null` when the image already fits.
 *
 * §16.4 bounds the **long edge**, so only one dimension is ever given: the manipulator
 * derives the other to preserve the ratio, and passing both would let a rounding error
 * squash the picture. Returning `null` for an image already inside the bound is not an
 * instruction to skip the re-encode — see `PHOTO_EXTENSION` for why every photo is
 * re-encoded regardless — it only means there is nothing to scale.
 *
 * A zero, a negative, or a non-finite dimension answers `null`. The picker documents
 * `width` as "can be `0` if the system did not provide the width", and resizing to a
 * fraction of nothing is a worse answer than leaving the image alone at whatever size it
 * is; the upload is bounded by the re-encode either way.
 */
export const resizeToFit = (
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number } | { height: number } | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width <= maxEdge && height <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
};

/**
 * The sentences. `ink2` and plain words, never colour — §1.1 is explicit that "failed
 * uploads and offline state" are the two cases most likely to grow a red, and there is no
 * red in the palette to grow.
 */

/**
 * Photo permission declined.
 *
 * §0.3: nothing scolds. Declining is a Member's answer, not an error — so this states
 * where the switch is and stops. It does not repeat the request, and the sheet does not
 * re-ask on the next tap: iOS answers a second `request` from cache anyway, so a nag would
 * be a nag that could not even work.
 */
export const photoPermissionCopy =
  'Photos are switched off for this app. You can turn them back on in Settings.';

/**
 * The tap landed and the photo did not — the offline case, and §17.1's boundary made
 * visible.
 *
 * The Member must never be told a photo saved when it did not, and must never be told the
 * *tap* failed when it did not: the Increment is on the board, the photo is the optional
 * part (§11.1), and the sentence has to say both in that order.
 */
export const photoUnavailableCopy =
  'Logged. The photo needs a connection, so it wasn’t added.';

/** The upload itself failed while online. Same shape, different cause, no blame. */
export const photoFailedCopy = 'Logged. The photo didn’t upload this time.';

/**
 * The picker handed back something that could not be read — an iCloud photo that never
 * downloaded, a format the manipulator refuses, a file gone between picking and reading.
 * Said before the tap rather than after it, so nothing has been claimed yet.
 */
export const photoUnreadableCopy = 'That photo couldn’t be read. Another one will work.';
