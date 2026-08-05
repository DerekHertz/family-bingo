/**
 * What each Feed row says (PRD §14, FRONTEND_DESIGN §3 `<FeedRow>`).
 *
 * The Feed is the Family's running record of everything that has happened this Year, and
 * it is **read when a Member opens the app; it never interrupts anyone** (CONTEXT.md).
 * That is the whole difference between this and §15's push: a Milestone is worth a phone
 * buzzing, an Increment is worth a line in a list, and both live here.
 *
 * Pure, and the copy lives here rather than in the renderer so it can be tested without
 * one — the sentences are the feature. Three rules from §7 that this file is where they
 * would leak back in:
 *
 *   - **Nothing ranks anyone.** No "first to", no ordering, no count of who did most
 *     (§13.5). A row says what one Member did, and nothing about anyone else.
 *   - **Actions are attributed to the Member, never the Guardian** (§4.2). This module
 *     never sees a Guardian; the row carries a `memberId` and that is who did it.
 *   - **Nothing scolds** (§0.3). There is no row for not doing something, and none of
 *     these sentences can be read as one.
 */

/** The `kind` column of the `feed` view (migration `20260801000021_feed.sql`). */
export type FeedKind =
  | 'increment'
  | 'milestone'
  | 'swap'
  | 'vote_resolved'
  | 'member_joined';

/**
 * One row of the view, in the client's spelling.
 *
 * Every branch of the view aliases every column, so most of these are null on most rows —
 * which is why the copy below is a `switch` on `kind` rather than a template that assumes
 * a field is there.
 */
export interface FeedEvent {
  readonly id: string;
  readonly kind: FeedKind;
  readonly createdAt: string;
  /** Null only on `vote_resolved` — a Family decision has no one author (§8.2). */
  readonly memberId: string | null;
  readonly position: number | null;
  readonly goalText: string | null;
  readonly note: string | null;
  /** Slice 16's photo. A Storage object key, never a URL — signed on demand (§16.2). */
  readonly attachmentPath: string | null;
  readonly milestoneType: string | null;
  readonly lineIndex: number | null;
  readonly beforeText: string | null;
  readonly beforeTarget: number | null;
  readonly afterText: string | null;
  readonly afterTarget: number | null;
  readonly voteKind: string | null;
  /** Already words, not an id: `'shared'`/`'personal'`, or the Family Goal's own text. */
  readonly voteOutcome: string | null;
}

/**
 * How the row is dressed (§3's treatment column).
 *
 * `complete` is **the only tinted row type** — §3 says so, and it is why finishing a Tile
 * reads as an event when you scroll past it and logging the ninth walk does not.
 */
export type FeedTone = 'plain' | 'complete' | 'seal' | 'quiet';

/**
 * A row's identity in a list. The view's `id` is the source row's id, so it is unique
 * only **together with `kind`** — two different tables could in principle answer with the
 * same uuid, and a React key that collided would drop a row silently.
 */
export const feedRowKey = (event: FeedEvent): string => `${event.kind}:${event.id}`;

export const toneOf = (event: FeedEvent): FeedTone => {
  if (event.kind === 'member_joined') return 'quiet';
  if (event.kind !== 'milestone') return 'plain';
  if (event.milestoneType === 'tile_completed') return 'complete';
  if (event.milestoneType === 'bingo' || event.milestoneType === 'blackout') return 'seal';
  // A later Line is explicitly the quieter Milestone (§13.2), so it does not get the seal.
  return 'plain';
};

/** What a row says: one line that names the Member and the thing, and at most one under it. */
export interface FeedCopy {
  readonly headline: string;
  readonly detail: string | null;
}

/**
 * The row's sentences.
 *
 * `nameOf` resolves a Member id to their name and `lineNameOf` an index to "Row 2" — both
 * passed in rather than imported, so this file holds copy and no lookups. A Member who has
 * left the Family still has rows in the Feed; `nameOf` is what decides what those say, and
 * it is the caller's problem because only the caller knows the roster.
 */
export const feedCopy = (
  event: FeedEvent,
  nameOf: (memberId: string | null) => string,
  lineNameOf: (lineIndex: number) => string,
): FeedCopy => {
  const who = nameOf(event.memberId);

  switch (event.kind) {
    case 'increment':
      // The Goal, not a verb. §3 puts the note in the body beneath, and the *number* of
      // Increments is deliberately absent: a Feed that counted them would be a ladder.
      return { headline: who, detail: event.goalText };

    case 'milestone':
      switch (event.milestoneType) {
        case 'tile_completed':
          return {
            headline: `${who} finished a goal`,
            detail: event.goalText,
          };
        case 'bingo':
          return {
            headline: `Bingo — ${who}`,
            detail:
              event.lineIndex === null
                ? 'Their first line.'
                : `${lineNameOf(event.lineIndex)}, their first line.`,
          };
        case 'line_completed':
          return {
            headline: `${who} closed another line`,
            detail: event.lineIndex === null ? null : lineNameOf(event.lineIndex),
          };
        case 'blackout':
          // §13.4: play continues to the end of the Year. A fact, not a finish line.
          return { headline: `Blackout — ${who}`, detail: 'All twenty-five squares.' };
        default:
          return { headline: who, detail: null };
      }

    case 'swap':
      // Three different things arrive as a `swap`, and one sentence for all of them says
      // something false about two.
      //
      //   - **Nothing was set down.** `swap_tile()` writes a Revision with a null
      //     `before_text` when the Tile was empty — an unfinished Board seals with empty
      //     squares (§10.2) and filling one later costs a Swap (§18.5). "Set a goal down"
      //     there invents an abandonment that never happened.
      //   - **The words are the same and the Target moved.** §18.5 is the reason Swaps are
      //     visible at all: *"anyone could lower a Target from 144 to 90 in November and
      //     manufacture a Bingo. Scarcity plus visibility closes that."* The Feed is the
      //     visibility half — so for the exact manoeuvre §18.5 names, it has to say the
      //     number changed, or it shows the same sentence twice and hides the only fact
      //     that matters.
      //   - A genuine replacement, which is the case "set down" was written for. §4.4's
      //     own words, and §7.10 forbids any screen implying they gave up on it.
      if (event.beforeText === null) {
        return { headline: `${who} filled an empty square`, detail: event.afterText };
      }
      if (
        event.afterText !== null &&
        event.beforeText.trim() === event.afterText.trim() &&
        event.beforeTarget !== null &&
        event.afterTarget !== null &&
        event.beforeTarget !== event.afterTarget
      ) {
        return {
          headline: `${who} changed a target`,
          detail: `${event.afterText}: ${event.beforeTarget} → ${event.afterTarget}`,
        };
      }
      return { headline: `${who} set a goal down`, detail: event.afterText };

    case 'vote_resolved':
      // No author, and no margin. §7.9 forbids showing a vote count as a numeral, and the
      // outcome is "stated as a fact, never as a defeat" (§4.3).
      if (event.voteKind === 'mode') {
        return event.voteOutcome === 'shared'
          ? { headline: 'The centre is a family goal this year', detail: null }
          : { headline: 'The centre is everyone’s own square this year', detail: null };
      }
      return { headline: 'The family goal is set', detail: event.voteOutcome };

    case 'member_joined':
      return { headline: `${who} joined`, detail: null };
  }
};

/**
 * What a screen reader hears instead of the row.
 *
 * One string rather than four focusable pieces: a Feed is read by scrolling past it, and a
 * row split into avatar / headline / detail / timestamp is four swipes to learn one thing.
 * The Swap is the exception worth spelling out, because struck-through text announces as
 * ordinary text and the row would otherwise say two goals with no relationship between
 * them.
 */
export const feedLabel = (
  event: FeedEvent,
  copy: FeedCopy,
  when: string,
  managed: boolean,
): string => {
  const parts: string[] = [copy.headline];
  // Only for a replacement. A filled-in empty square has nothing to have come *from*, and
  // a Target change already carries both numbers in its detail — announcing a move between
  // two identical sentences would read as a change that did not happen.
  //
  // (Written without the obvious phrasing on purpose: `src/domain/boundaries.test.ts`
  // greps this directory for import syntax, and the natural wording of that sentence
  // contains one.)
  if (
    event.kind === 'swap' &&
    event.beforeText !== null &&
    event.beforeText.trim() !== (event.afterText ?? '').trim()
  ) {
    parts.push(`from “${event.beforeText}” to “${event.afterText ?? ''}”`);
  } else if (copy.detail !== null) {
    parts.push(copy.detail);
  }
  if (event.note !== null && event.note.trim() !== '') parts.push(event.note);
  if (event.attachmentPath !== null) parts.push('With a photo.');
  // The clay dot is the only sign a Guardian tapped it (§4.7), and a dot announces as
  // nothing at all. Said last, so the Member's own action is heard first.
  if (managed) parts.push('A managed member.');
  parts.push(when);
  return parts.join('. ');
};
