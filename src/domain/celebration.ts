/**
 * What to celebrate, and exactly once (PRD §12.2, §13.2, FRONTEND_DESIGN §5, §6 A5).
 *
 * > **Complete** … Fires **once per Tile, ever** (§12.2) — gate on the milestone insert,
 * > not on `count >= target`, or an offline replay re-fires it.
 *
 * Pure, no imports, so the rule can be tested without a renderer or a database. The
 * component holds the "already seen" set; this decides what is new and how loud it is.
 *
 * The distinction is not academic. `count >= target` stays true forever once it is true,
 * so anything keyed on it congratulates a Member every time they reopen a Tile they
 * finished in March — and once §17.4's queue replays, every time the app reconnects too.
 * A Milestone happens once, because `one_tile_completed_per_tile` says so.
 *
 * **Keyed on the Milestone's id, not the Tile's.** A Line and a Blackout have no Tile, so
 * a Tile-keyed set could never see them; the Milestone row is the one identifier every
 * kind of event has, and the database already guarantees it appears exactly once.
 */

/** The `type` column of `milestones`, and the whole of it (§13.2, §13.3). */
export type MilestoneKind = 'tile_completed' | 'bingo' | 'line_completed' | 'blackout';

/** Only what deciding a celebration needs — the query row is wider. */
export interface CelebratedMilestone {
  readonly id: string;
  readonly type: MilestoneKind;
  readonly tileId: string | null;
  readonly lineIndex: number | null;
}

/**
 * Milestones present now that were not present last time, **in the order they were given**.
 *
 * `seen` is everything already celebrated **including anything that arrived before the
 * screen opened**. That is the load-bearing part: a Member opening a Board they finished
 * last week must not walk into five celebrations, so the first read seeds `seen` with
 * everything and celebrates none of it. Only what appears *afterwards* is new.
 *
 * The order is the caller's and is deliberately not re-sorted. An earlier version sorted
 * on `id`, which is `gen_random_uuid()` — stable in the sense that the same input gives
 * the same output, and meaningless in every other sense. It threw away the `created_at`
 * ordering the query establishes, so when two Lines closed together the one whose random
 * id happened to sort lower was the one drawn.
 */
export const newlyCelebrated = <T extends { readonly id: string }>(
  current: readonly T[],
  seen: ReadonlySet<string>,
): T[] => current.filter((m) => !seen.has(m.id));

/**
 * How much noise a Milestone is worth, and therefore which one speaks when several land
 * together.
 *
 * Several genuinely do land together: the tap that closes a Line closes a Tile first, and
 * the tap that finishes a Board closes a Tile, up to three Lines and the Blackout in one
 * transaction. Firing every haptic in that set reads as a malfunction rather than a
 * reward, so the loudest one speaks for all of them.
 */
const WEIGHT: Record<MilestoneKind, number> = {
  tile_completed: 0,
  line_completed: 1,
  bingo: 2,
  blackout: 3,
};

/**
 * The single Milestone to feel and to announce, out of everything that just arrived.
 *
 * `null` for an empty set, which is the common case on every render that changed nothing.
 * Ties break on the order given, which `newlyCelebrated` has already made stable.
 */
export const loudest = <T extends CelebratedMilestone>(fresh: readonly T[]): T | null => {
  let best: T | null = null;
  for (const m of fresh) {
    if (best === null || WEIGHT[m.type] > WEIGHT[best.type]) best = m;
  }
  return best;
};

/**
 * The haptic §5 asks for, as a name rather than a call — the domain layer imports nothing,
 * including `expo-haptics`, and `src/domain/boundaries.test.ts` enforces it.
 *
 * > Haptics: `light` on increment (both platforms) · `success` / `CONFIRM` on tile
 * > complete · five `light` impacts 60ms apart on Bingo.
 *
 * A Blackout takes the Bingo pattern deliberately. §5 names three haptics and Blackout is
 * not one of them, so the choice is between inventing a fourth and reusing the loudest
 * that exists; the rarest event in the app should not be quieter than the Line inside it.
 * A `line_completed` is explicitly "quieter" (§13.2), so it takes the Tile's.
 */
export type CelebrationHaptic = 'success' | 'bingo';

export const hapticFor = (kind: MilestoneKind): CelebrationHaptic =>
  kind === 'bingo' || kind === 'blackout' ? 'bingo' : 'success';

/**
 * What a screen reader says, once, on the tap that closed it (§6 A5).
 *
 * `null` for a Tile: the square's own label already flips to "Complete" and announcing it
 * a second time says the same fact twice. Only the events a Member could otherwise miss —
 * a Line closing five squares away from the one they tapped — get a sentence.
 *
 * `name` is `lineName()` from `./lines`, passed in rather than imported so this file stays
 * a table of copy with no geometry in it.
 */
export const announcementFor = (
  milestone: CelebratedMilestone,
  name: (lineIndex: number) => string,
): string | null => {
  switch (milestone.type) {
    case 'tile_completed':
      return null;
    case 'bingo':
      return milestone.lineIndex === null
        ? 'Bingo.'
        : `Bingo. ${name(milestone.lineIndex)} complete.`;
    case 'line_completed':
      return milestone.lineIndex === null
        ? 'A line is complete.'
        : `${name(milestone.lineIndex)} complete.`;
    case 'blackout':
      // Not "you won" (§13.4 — play continues) and not a superlative (§13.5). The fact.
      return 'Blackout. All twenty-five.';
  }
};

/**
 * Everything a Member should be told about what just landed, as one sentence.
 *
 * The loudest Milestone speaks, and a Line that closed underneath it speaks too. §5's
 * "one notification however many landed at once" is an argument about **haptics** — five
 * buzzes read as a malfunction — and it does not transfer to speech: a screen-reader
 * Member has no other channel for *"the top-left diagonal also closed"*, and §6 A5 asks
 * for a Line to be announced on the tap that closed it.
 *
 * `null` when there is nothing worth saying, which is every tap that only moves a count.
 */
export const announcementOf = (
  fresh: readonly CelebratedMilestone[],
  name: (lineIndex: number) => string,
): string | null => {
  const loud = loudest(fresh);
  if (loud === null) return null;
  const line = loudest(fresh.filter((m) => m.lineIndex !== null));
  const sentences = [
    announcementFor(loud, name),
    line === null || line.id === loud.id ? null : announcementFor(line, name),
  ].filter((s): s is string => s !== null);
  return sentences.length === 0 ? null : sentences.join(' ');
};

/**
 * Whether a Milestone is one the card will show.
 *
 * Tiles are left out — twenty-five of them land over a Year, and a card that changed every
 * few days would stop being read. Stated as its own predicate because two things need the
 * same answer: the card's headline, and choosing *which* Milestone the card is about.
 */
export const cardWorthy = (milestone: CelebratedMilestone): boolean =>
  milestone.type !== 'tile_completed';

/**
 * The Milestone the card should be about, out of everything on the Board.
 *
 * **Not simply the last row.** Every Milestone written by one tap shares a `created_at`,
 * because `now()` is the transaction's timestamp and the tap that finishes a Board writes
 * a Tile, up to four Lines and the Blackout in a single transaction. `order by created_at`
 * has no tiebreaker inside that group, so "the last row" is whichever one the plan
 * happened to return — and the card could read "Column 4" on the day somebody finished
 * all twenty-five squares.
 *
 * So: the newest instant, then the loudest thing that happened in it.
 */
export const cardMilestone = <T extends CelebratedMilestone & { readonly createdAt: string }>(
  all: readonly T[],
): T | null => {
  const eligible = all.filter(cardWorthy);
  if (eligible.length === 0) return null;
  const newest = eligible.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).createdAt;
  return loudest(eligible.filter((m) => m.createdAt === newest));
};

/**
 * What the card says (FRONTEND_DESIGN §4, "Milestone card").
 *
 * Deliberately not congratulatory and deliberately not a count: it states what happened
 * and nothing about how that compares to anyone (§13.5). `null` for anything `cardWorthy`
 * rejects.
 */
export const milestoneHeadline = (
  milestone: CelebratedMilestone,
  name: (lineIndex: number) => string,
): string | null => {
  switch (milestone.type) {
    case 'tile_completed':
      return null;
    case 'bingo':
      return milestone.lineIndex === null ? 'Bingo' : `Bingo — ${name(milestone.lineIndex).toLowerCase()}`;
    case 'line_completed':
      return milestone.lineIndex === null ? 'Another line' : name(milestone.lineIndex);
    case 'blackout':
      return 'Blackout';
  }
};
