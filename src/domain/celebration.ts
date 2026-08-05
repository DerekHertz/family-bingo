/**
 * What to celebrate, and exactly once (PRD §12.2, FRONTEND_DESIGN §5).
 *
 * > **Complete** … Fires **once per Tile, ever** (§12.2) — gate on the milestone insert,
 * > not on `count >= target`, or an offline replay re-fires it.
 *
 * Pure, no imports, so the rule can be tested without a renderer or a database. The
 * component holds the "already seen" set; this decides what is new.
 *
 * The distinction is not academic. `count >= target` stays true forever once it is true,
 * so anything keyed on it congratulates a Member every time they reopen a Tile they
 * finished in March — and once §17.4's queue replays, every time the app reconnects too.
 * A Milestone happens once, because `one_tile_completed_per_tile` says so.
 */

/**
 * Milestones present now that were not present last time, in a stable order.
 *
 * `seen` is everything already celebrated **including anything that arrived before the
 * screen opened**. That is the load-bearing part: a Member opening a Board they finished
 * last week must not walk into five celebrations, so the first read seeds `seen` with
 * everything and celebrates none of it. Only what appears *afterwards* is new.
 */
export const newlyCelebrated = (
  current: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): string[] => [...current].filter((id) => !seen.has(id)).sort();
