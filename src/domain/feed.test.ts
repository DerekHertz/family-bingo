import { describe, expect, it } from 'vitest';
import { feedCopy, feedRowKey, feedLabel, toneOf, type FeedEvent } from './feed';
import { lineName } from './lines';

const base: FeedEvent = {
  id: 'e1',
  kind: 'increment',
  createdAt: '2026-03-14T09:00:00Z',
  memberId: 'm1',
  position: 3,
  goalText: 'Walk the dog',
  note: null,
  attachmentPath: null,
  milestoneType: null,
  lineIndex: null,
  beforeText: null,
  beforeTarget: null,
  afterText: null,
  afterTarget: null,
  voteKind: null,
  voteOutcome: null,
};

const event = (over: Partial<FeedEvent>): FeedEvent => ({ ...base, ...over });
const milestone = (type: string, over: Partial<FeedEvent> = {}): FeedEvent =>
  event({ kind: 'milestone', milestoneType: type, ...over });

const named = (name: string) => () => name;
const copyOf = (e: FeedEvent, name = 'Ada') => feedCopy(e, named(name), lineName);

describe('feedRowKey (§14.1)', () => {
  // The view's `id` is the source row's id, so it identifies a row only together with the
  // table it came from. A colliding React key drops a row without saying so.
  it('is unique across kinds that share an id', () => {
    expect(feedRowKey(event({ id: 'x', kind: 'increment' }))).not.toBe(
      feedRowKey(event({ id: 'x', kind: 'swap' })),
    );
  });
});

describe('toneOf (§3)', () => {
  // "The only tinted row type." If a second one ever gets a background, the tint stops
  // meaning "a goal closed".
  it('tints a completed Tile and nothing else', () => {
    expect(toneOf(milestone('tile_completed'))).toBe('complete');
    expect(toneOf(event({}))).toBe('plain');
    expect(toneOf(event({ kind: 'swap' }))).toBe('plain');
    expect(toneOf(event({ kind: 'vote_resolved' }))).toBe('plain');
  });

  it('seals a Bingo and a Blackout', () => {
    expect(toneOf(milestone('bingo', { lineIndex: 0 }))).toBe('seal');
    expect(toneOf(milestone('blackout'))).toBe('seal');
  });

  // §13.2 — every Line after the first is the *quieter* Milestone. It does not get the
  // clay seal, or a Member's eighth Line would look like their first.
  it('does not seal a later Line', () => {
    expect(toneOf(milestone('line_completed', { lineIndex: 6 }))).toBe('plain');
  });

  it('renders a Member arriving quietly', () => {
    expect(toneOf(event({ kind: 'member_joined' }))).toBe('quiet');
  });
});

describe('feedCopy — Increments (§11.1, §13.5)', () => {
  it('names the Member and the Goal', () => {
    expect(copyOf(event({}))).toEqual({ headline: 'Ada', detail: 'Walk the dog' });
  });

  // A Feed that counted Increments per Member would be a ladder, which §13.5 forbids and
  // §7.2 forbids again.
  it('never states how many', () => {
    const { headline, detail } = copyOf(event({}));
    expect(`${headline} ${detail}`).not.toMatch(/\d/);
  });
});

describe('feedCopy — Milestones (§13.2, §13.4)', () => {
  it('names the Line a Bingo closed', () => {
    expect(copyOf(milestone('bingo', { lineIndex: 1 }))).toEqual({
      headline: 'Bingo — Ada',
      detail: 'Row 2, their first line.',
    });
  });

  it('survives a Bingo with no Line index', () => {
    expect(copyOf(milestone('bingo')).detail).toBe('Their first line.');
  });

  it('says a later Line more quietly, and never calls it a Bingo', () => {
    const copy = copyOf(milestone('line_completed', { lineIndex: 10 }));
    expect(copy.headline).toBe('Ada closed another line');
    expect(copy.detail).toBe('The top-left diagonal');
    expect(`${copy.headline} ${copy.detail}`.toLowerCase()).not.toContain('bingo');
  });

  it('states a Blackout as a fact, not a finish line (§13.4)', () => {
    const copy = copyOf(milestone('blackout'));
    expect(copy.headline).toBe('Blackout — Ada');
    const said = `${copy.headline} ${copy.detail}`.toLowerCase();
    expect(said).not.toMatch(/win|won|first|beat/);
  });

  it('names the Goal a completed Tile carried', () => {
    expect(copyOf(milestone('tile_completed'))).toEqual({
      headline: 'Ada finished a goal',
      detail: 'Walk the dog',
    });
  });
});

describe('feedCopy — Swaps (§4.4, §7.10, §18.5)', () => {
  const swap = event({
    kind: 'swap',
    beforeText: 'Run a marathon',
    beforeTarget: 1,
    afterText: 'Walk every day',
    afterTarget: 200,
  });

  it('uses §4.4′s own words and never implies giving up', () => {
    const copy = copyOf(swap);
    expect(copy.headline).toBe('Ada set a goal down');
    expect(copy.detail).toBe('Walk every day');
    expect(copy.headline.toLowerCase()).not.toMatch(/gave up|quit|failed|abandon|deleted/);
  });

  // `swap_tile()` writes a Revision with a null `before_text` when the Tile was empty:
  // an unfinished Board seals with empty squares (§10.2) and filling one costs a Swap
  // (§18.5). "Set a goal down" there invents an abandonment that never happened.
  it('does not claim a goal was set down when there was not one', () => {
    const copy = copyOf(
      event({ kind: 'swap', beforeText: null, beforeTarget: null, afterText: 'Learn chess', afterTarget: 1 }),
    );
    expect(copy.headline).toBe('Ada filled an empty square');
    expect(copy.detail).toBe('Learn chess');
  });

  // §18.5 is the whole reason Swaps are visible: "anyone could lower a Target from 144 to
  // 90 in November and manufacture a Bingo. Scarcity plus visibility closes that." The
  // Feed is the visibility half, so for that exact manoeuvre it has to show the number.
  it('shows the number when a Target moved and the words did not', () => {
    const copy = copyOf(
      event({
        kind: 'swap',
        beforeText: 'Read 24 books',
        beforeTarget: 24,
        afterText: 'Read 24 books',
        afterTarget: 12,
      }),
    );
    expect(copy.headline).toBe('Ada changed a target');
    expect(copy.detail).toContain('24');
    expect(copy.detail).toContain('12');
  });
});

describe('feedCopy — vote outcomes (§4.3, §7.9)', () => {
  it('states the mode outcome as a fact, with no count', () => {
    const shared = copyOf(event({ kind: 'vote_resolved', voteKind: 'mode', voteOutcome: 'shared' }));
    expect(shared.headline).toBe('The centre is a family goal this year');
    expect(shared.headline).not.toMatch(/\d/);

    const personal = copyOf(
      event({ kind: 'vote_resolved', voteKind: 'mode', voteOutcome: 'personal' }),
    );
    expect(personal.headline).toBe('The centre is everyone’s own square this year');
  });

  it('names the Family Goal that won, and nobody who proposed it', () => {
    const copy = copyOf(
      event({ kind: 'vote_resolved', voteKind: 'goal', voteOutcome: 'Eat together on Sundays' }),
    );
    expect(copy.headline).toBe('The family goal is set');
    expect(copy.detail).toBe('Eat together on Sundays');
  });

  // §7.9: a proposal has an author, so naming a winner would rank the people who proposed.
  it('never mentions a proposer or a margin', () => {
    const copy = copyOf(
      event({ kind: 'vote_resolved', voteKind: 'goal', voteOutcome: 'Eat together' }),
    );
    expect(`${copy.headline}`).not.toContain('Ada');
  });
});

describe('feedCopy — Members arriving', () => {
  it('says only that they joined', () => {
    expect(copyOf(event({ kind: 'member_joined' }))).toEqual({
      headline: 'Ada joined',
      detail: null,
    });
  });
});

describe('feedLabel (§6, §4.7)', () => {
  const say = (e: FeedEvent, managed = false) =>
    feedLabel(e, copyOf(e), '14 Mar', managed);

  it('reads as one sentence, headline first', () => {
    expect(say(event({}))).toBe('Ada. Walk the dog. 14 Mar');
  });

  it('reads a note out, because it is the Member′s own words', () => {
    expect(say(event({ note: 'Freezing out there' }))).toContain('Freezing out there');
  });

  it('ignores a note that is only whitespace', () => {
    expect(say(event({ note: '   ' }))).toBe('Ada. Walk the dog. 14 Mar');
  });

  // Struck-through text announces as ordinary text, so without this a Swap row reads as
  // two unrelated goals.
  it('says a Swap as a change, not as two goals', () => {
    const swap = event({
      kind: 'swap',
      beforeText: 'Run a marathon',
      afterText: 'Walk every day',
    });
    expect(say(swap)).toBe(
      'Ada set a goal down. from “Run a marathon” to “Walk every day”. 14 Mar',
    );
  });

  // "from X to X" would announce a change that did not happen — the words are identical
  // and it is the Target that moved, which the detail already carries.
  it('does not say from-and-to when only the Target moved', () => {
    const said = say(
      event({
        kind: 'swap',
        beforeText: 'Read 24 books',
        beforeTarget: 24,
        afterText: 'Read 24 books',
        afterTarget: 12,
      }),
    );
    expect(said).not.toContain('from “');
    expect(said).toContain('24 → 12');
  });

  // §4.7: the clay dot is the only sign a Guardian tapped it, and a dot announces as
  // nothing at all.
  it('says a Managed Member is one, after their own action', () => {
    const said = say(event({}), true);
    expect(said).toContain('A managed member.');
    expect(said.indexOf('Ada')).toBeLessThan(said.indexOf('A managed member'));
  });

  it('does not say it for anyone else', () => {
    expect(say(event({}), false)).not.toContain('managed');
  });

  it('mentions a photo without describing it', () => {
    expect(say(event({ attachmentPath: 'fam/inc.jpg' }))).toContain('With a photo.');
  });
});
