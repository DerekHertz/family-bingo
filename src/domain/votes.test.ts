import { describe, expect, it } from 'vitest';
import { type Proposal, resolveGoalVote, resolveModeVote } from './votes';

const proposals = (...ids: string[]): Proposal[] =>
  ids.map((id, order) => ({ id, order }));

describe('resolveModeVote (§8)', () => {
  it('resolves to the majority of Ballots cast', () => {
    // The acceptance test: 2 shared, 1 personal, 1 never votes.
    expect(resolveModeVote(['shared', 'shared', 'personal'])).toBe('shared');
  });

  it('treats a non-voter as an abstention, never as a blocker (§8.2, §8.4)', () => {
    // A single Ballot in a Family of five still decides it. Silence forfeits a say;
    // it never freezes four other people's Boards.
    expect(resolveModeVote(['shared'])).toBe('shared');
  });

  it('falls back to personal on a tie (§8.3)', () => {
    expect(resolveModeVote(['shared', 'personal'])).toBe('personal');
    expect(resolveModeVote(['shared', 'shared', 'personal', 'personal'])).toBe('personal');
  });

  it('falls back to personal when nobody votes at all (§8.3)', () => {
    expect(resolveModeVote([])).toBe('personal');
  });

  it('resolves to personal when personal wins outright', () => {
    expect(resolveModeVote(['personal', 'personal', 'shared'])).toBe('personal');
  });

  it('has no quorum — one Ballot out of twenty is enough (§8.4)', () => {
    expect(resolveModeVote(['shared'])).toBe('shared');
  });
});

describe('resolveGoalVote (§9)', () => {
  it('gives every Board the plurality winner', () => {
    // The acceptance test: 3 Proposals, "Camping trip" wins with 2 votes.
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon', 'garden'),
      ballots: ['camping', 'camping', 'marathon'],
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'camping' });
  });

  it('wins on a plurality, not a majority', () => {
    const result = resolveGoalVote({
      proposals: proposals('a', 'b', 'c'),
      ballots: ['a', 'a', 'b', 'c'], // 2 of 4 — a plurality, short of a majority
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'a' });
  });

  it('falls back to personal when nobody proposed anything (§9.3)', () => {
    // Never leave the Center Tile empty or the Board unsealed.
    expect(resolveGoalVote({ proposals: [], ballots: [] })).toEqual({
      outcome: 'personal',
      reason: 'no_proposals',
    });
  });

  it('lets the Organizer break a tie (§9.2)', () => {
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon'),
      ballots: ['camping', 'marathon'],
      organizerTiebreak: 'marathon',
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'marathon' });
  });

  it('falls back to the earliest Proposal when the Organizer never breaks the tie', () => {
    // Deterministic and explainable to a child, and — critically — it means the seal
    // job never waits on an Organizer who does not tap (§8.4).
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon'),
      ballots: ['camping', 'marathon'],
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'camping' });
  });

  it('ignores an Organizer choice that is not among the tied Proposals', () => {
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon', 'garden'),
      ballots: ['camping', 'marathon'], // garden has 0 votes and is not tied for first
      organizerTiebreak: 'garden',
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'camping' });
  });

  it('ignores an Organizer choice when there is no tie to break', () => {
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon'),
      ballots: ['camping', 'camping', 'marathon'],
      organizerTiebreak: 'marathon',
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'camping' });
  });

  it('picks the earliest Proposal when Proposals exist but nobody voted', () => {
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon'),
      ballots: [],
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'camping' });
  });

  it('uses arrival order, not array order, to break a tie', () => {
    const result = resolveGoalVote({
      proposals: [
        { id: 'later', order: 9 },
        { id: 'earlier', order: 1 },
      ],
      ballots: ['later', 'earlier'],
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'earlier' });
  });

  it('ignores Ballots cast for a Proposal that no longer exists', () => {
    const result = resolveGoalVote({
      proposals: proposals('camping', 'marathon'),
      ballots: ['withdrawn', 'withdrawn', 'withdrawn', 'marathon'],
    });
    expect(result).toEqual({ outcome: 'shared', proposalId: 'marathon' });
  });

  it('resolves with a single Proposal and no votes', () => {
    expect(resolveGoalVote({ proposals: proposals('only'), ballots: [] })).toEqual({
      outcome: 'shared',
      proposalId: 'only',
    });
  });

  it('is deterministic — the same input always resolves the same way', () => {
    const input = {
      proposals: proposals('a', 'b', 'c', 'd'),
      ballots: ['a', 'b', 'c', 'd'],
    };
    const first = resolveGoalVote(input);
    for (let n = 0; n < 20; n++) expect(resolveGoalVote(input)).toEqual(first);
  });
});
