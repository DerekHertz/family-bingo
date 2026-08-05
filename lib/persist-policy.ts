/**
 * What may be written to a Member's disk (PRD §17.5, §7.6, §8.1).
 *
 * > Board and Feed cached read-only so the app opens to content rather than a spinner.
 * > (§17.5)
 *
 * That is a performance requirement with a privacy consequence, and the consequence is
 * bigger than the requirement. Persisting the react-query cache means the Family's data —
 * names, Goals, notes a Member wrote, who did what and when — stops living in memory for
 * the length of a session and starts living in a file that survives the app being killed.
 * Inside the app's private container, deleted with the app, on a handset the Member
 * unlocks; the same posture as the offline queue beside it. Acceptable, but only if
 * somebody decides *what* goes there rather than "whatever the cache happened to hold".
 *
 * So this is an **allowlist, and it denies by default.** A query added next year is not
 * persisted until someone adds its prefix here and thinks about that sentence. The
 * alternative — a denylist — fails silently and in the wrong direction: the day somebody
 * adds a query holding something that should never be on a disk, the denylist does not
 * mention it and it is written out.
 *
 * **Two things are excluded on purpose and are the reason this file exists:**
 *
 *   - **`photo-urls` — signed URLs, never.** §7.6: "do not use a public Storage bucket or
 *     a long-lived URL for a photo, and do not cache a photo to disk outside the app's
 *     private container". A signed URL written into AsyncStorage *is* a long-lived URL by
 *     another route: it is a stateless HMAC that nothing revokes (§16.2), sitting in a file
 *     long after the Member closed the app, still good for the bytes of a photograph of a
 *     child. The URLs are re-minted in a single round trip whenever the Feed opens, so
 *     there is nothing to gain and a boundary to lose.
 *   - **The image bytes themselves are never written by this app at all.** `<Image>` keeps
 *     its own decode cache inside the app's container and that is the platform's business;
 *     nothing here copies a photo to disk, and `lib/photo.ts` deletes the one temporary
 *     file it creates as soon as it has been uploaded.
 *
 * Pure and tested, because the failure mode is invisible: nothing in the app looks
 * different if this is wrong.
 */

/**
 * The query key prefixes §17.5 asks for, and the ones the Board and Feed cannot render
 * without.
 *
 * A Feed row with no roster reads "A member" for every name (`app/year/feed.tsx` treats a
 * missing roster as an error for exactly that reason), so persisting the Feed without the
 * roster would open the app to a screenful of confident wrong answers — which is worse
 * than a spinner and is what §17.5 is trying to avoid in the first place.
 */
export const PERSISTED_PREFIXES = [
  // The Board (§17.5): the Tiles, the header, the counts the growth ladder is derived
  // from, and the Milestones the completion state is gated on.
  'board',
  'board-head',
  'boards',
  'tile-counts',
  'milestones',
  // The tile sheet's "Recent" — the same Increments the counts are made of.
  //
  // These two are also what carries a **queued** tap across a restart. §17.2's optimistic
  // patch is the only record of an undrained tap that anything renders, and §17.3 says the
  // queue survives the app being killed — so without these persisted, a Member who logged
  // three walks underground and relaunched would find the ring back where it started until
  // the drain caught up.
  'increments',
  // The Feed (§17.5), and the two lookups its rows are rendered through.
  'feed',
  'roster',
  // The Family and Year names in both screens' headers.
  'families',
  'years',
] as const;

/**
 * Everything a Member can be *shown* from disk is a read. Nothing here is a write, and
 * nothing here is authority: RLS decides every row on the next refetch, and a persisted
 * answer that the server would now refuse is corrected the moment there is a network.
 * §17.5 says "read-only" and this is where that is true rather than merely intended.
 */
export const shouldPersistKey = (key: unknown): boolean => {
  if (!Array.isArray(key)) return false;
  const [prefix] = key as unknown[];
  if (typeof prefix !== 'string') return false;
  return (PERSISTED_PREFIXES as readonly string[]).includes(prefix);
};
