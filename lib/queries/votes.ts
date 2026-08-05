/**
 * The Centre — Slices 8 and 9 (PRD §8, §9, FRONTEND_DESIGN §4.3).
 *
 * Two Votes per Year, both opened by `open_year()`: `mode` decides whether the middle
 * square is shared or personal, and `goal` decides which Family Goal goes on it if the
 * answer was shared.
 *
 * **§8.4 governs everything here: never blockable by inaction.** No quorum, no unanimity,
 * no waiting on a non-voter. Nothing in this file may grow a "waiting for N more votes"
 * — in any family of five, one person is a lurker, and their silence must not freeze four
 * other people's Boards. The resolution runs on a `pg_cron` deadline with no client
 * involved, and `src/domain/votes.ts` is what the app shows in the meantime.
 *
 * Ballots go through `cast_ballot()` because a Ballot has to agree with its Vote's kind
 * and that check spans two tables. Proposals are written directly — they are one of the
 * two tables the client writes itself (schema.md §4.2), with the rules in a trigger
 * rather than an RPC guard, because a guard in a function nobody is obliged to call
 * guards nothing.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isManaged, votersFor, type Voter } from '../../src/domain/member';
import { supabase } from '../supabase';
import { useRoster } from './invitations';

export const MAX_PROPOSALS_PER_MEMBER = 3;

export interface CentreVote {
  id: string;
  kind: 'mode' | 'goal';
  status: 'open' | 'resolved';
  /** What the Vote decided, once it has. Null while it is still open. */
  outcome: string | null;
  closesAt: string;
  organizerTiebreakProposalId: string | null;
}

export interface CentreProposal {
  id: string;
  memberId: string;
  memberName: string;
  text: string;
  createdAt: string;
}

export interface CentreBallot {
  memberId: string;
  memberName: string;
  isManaged: boolean;
  choiceMode: 'shared' | 'personal' | null;
  proposalId: string | null;
}

/** What the Votes themselves say. The Family's Members are the roster's business. */
export interface CentreVotes {
  modeVote: CentreVote | null;
  goalVote: CentreVote | null;
  proposals: CentreProposal[];
  modeBallots: CentreBallot[];
  goalBallots: CentreBallot[];
}

export interface Centre extends CentreVotes {
  /** Members the caller may vote as: themselves plus any child they guard (§4.3). */
  voters: Voter[];
}

/**
 * Carries the Account because every row underneath it is RLS-filtered, so a read fired
 * before the session resolved would cache an empty Centre against a key the real Account
 * then reused — the trap `boardHeadKey` was fixed for.
 *
 * It no longer carries the Account because of `voters`: those are composed from the
 * roster on the way out and are not in this cache entry at all.
 */
export const centreKey = (yearId: string, accountId: string, familyId: string) =>
  ['centre', yearId, accountId, familyId] as const;

/**
 * Everything the Centre screen needs: the Votes, plus who this Account may vote as.
 *
 * Ballots come back with the voter's name attached because §4.3 renders other people's
 * votes as faces — "22pt voter avatars, right-aligned" — rather than as a count. A count
 * is a scoreboard; faces are a family.
 *
 * ## Why the Members are not read here
 *
 * They were, and it was the same `select` `useRoster` already runs: same table, same
 * `family_id` filter, same `joined_at` order, one column apart, into a second cache entry
 * with a second shape. Two reads of one list is two lists that can disagree — a Member
 * approved between them appears on the roster and cannot be voted as, or the reverse.
 *
 * So the roster is the Family's single Member read now, and `voters` is `votersFor()` over
 * it. That is also what keeps the answer per-Account correct: `rosterKey` is keyed by
 * Family alone, deliberately, because those rows ARE the same for everyone who may see
 * them — it is the *narrowing* that differs by Account, and doing it outside the cache is
 * what stops one Account's children being served to another. (`SIGNED_OUT` clears the
 * client regardless.)
 *
 * The roster's failure is this hook's failure. Without it there is no way to know who the
 * caller may vote as, and rendering the Centre with an empty `voters` list would disable
 * every control on the screen with nothing on it to say why.
 */
export function useCentre(
  yearId: string | undefined,
  accountId: string | undefined,
  familyId: string | undefined,
) {
  const roster = useRoster(familyId);

  const votes = useQuery({
    queryKey: centreKey(yearId ?? 'none', accountId ?? 'anonymous', familyId ?? 'none'),
    enabled: yearId !== undefined && accountId !== undefined && familyId !== undefined,
    queryFn: async (): Promise<CentreVotes> => {
      const { data: voteRows, error: voteError } = await supabase
        .from('votes')
        .select('id, kind, status, outcome, closes_at, organizer_tiebreak_proposal_id')
        .eq('year_id', yearId ?? '');
      if (voteError !== null) throw voteError;

      const votes: CentreVote[] = (voteRows ?? []).map((v) => ({
        id: v.id as string,
        kind: v.kind as 'mode' | 'goal',
        status: v.status as 'open' | 'resolved',
        outcome: v.outcome as string | null,
        closesAt: v.closes_at as string,
        organizerTiebreakProposalId: v.organizer_tiebreak_proposal_id as string | null,
      }));
      const modeVote = votes.find((v) => v.kind === 'mode') ?? null;
      const goalVote = votes.find((v) => v.kind === 'goal') ?? null;
      const ids = votes.map((v) => v.id);

      // A Year with no Votes is a Year opened before slice 8's migration. Nothing to show
      // and nothing to fetch — returning early beats four queries with an empty `in`.
      if (ids.length === 0) {
        return { modeVote, goalVote, proposals: [], modeBallots: [], goalBallots: [] };
      }

      const [{ data: proposalRows, error: pErr }, { data: ballotRows, error: bErr }] =
        await Promise.all([
          supabase
            .from('proposals')
            .select('id, vote_id, member_id, text, created_at, member:member_id (display_name)')
            // Arrival order, and never re-sorted by votes (§4.3) — a list that reshuffles
            // as votes land turns a family decision into a horse race.
            .in('vote_id', ids)
            // `id` as the secondary key, matching `resolve_center_vote`'s
            // `order by t.created_at asc, t.id asc` — two Proposals written in one
            // transaction share a created_at, and the tiebreak has to agree with the SQL.
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }),
          supabase
            .from('ballots')
            .select('vote_id, member_id, choice_mode, proposal_id, member:member_id (display_name, account_id)')
            .in('vote_id', ids),
        ]);
      if (pErr !== null) throw pErr;
      if (bErr !== null) throw bErr;

      const proposals: CentreProposal[] = (proposalRows ?? [])
        .filter((p) => p.vote_id === goalVote?.id)
        .map((p) => ({
          id: p.id as string,
          memberId: p.member_id as string,
          memberName:
            (p.member as unknown as { display_name: string } | null)?.display_name ?? '',
          text: p.text as string,
          createdAt: p.created_at as string,
        }));

      const ballotsFor = (voteId: string | undefined): CentreBallot[] =>
        (ballotRows ?? [])
          .filter((b) => b.vote_id === voteId)
          .map((b) => {
            const member = b.member as unknown as {
              display_name: string;
              account_id: string | null;
            } | null;
            return {
              memberId: b.member_id as string,
              memberName: member?.display_name ?? '',
              // A Ballot whose Member row RLS withheld is nobody's child: a missing row
              // means "we cannot see them", not "no Account".
              isManaged: member == null ? false : isManaged(member),
              choiceMode: b.choice_mode as 'shared' | 'personal' | null,
              proposalId: b.proposal_id as string | null,
            };
          });

      return {
        modeVote,
        goalVote,
        proposals,
        modeBallots: ballotsFor(modeVote?.id),
        goalBallots: ballotsFor(goalVote?.id),
      };
    },
  });

  /**
   * The per-Account narrowing, done outside both caches.
   *
   * `useRoster` is keyed by Family and holds the whole Family in join order — including
   * pending Members, which `votersFor` drops through `isControlledBy` (§3.3). The Family
   * filter that used to live in this file's own `select` is `useRoster`'s `.eq('family_id',
   * …)` now, and it is still the half that must not be lost: `controlled_member_ids()` is
   * not Family-scoped, so somebody in two Families matches `account_id` twice and the
   * Centre would default to voting as the wrong Family's Member — every write refused by
   * `cast_ballot`'s `family_of_vote <> family_of_member` guard, forever, with nothing on
   * screen to explain it.
   */
  const data: Centre | undefined =
    votes.data === undefined || roster.data === undefined
      ? undefined
      : { ...votes.data, voters: votersFor(roster.data.members, accountId) };

  // Three fields rather than the whole query result, because there is no single query
  // behind this any more and pretending otherwise would hand the screen a `refetch` that
  // reloaded half of what it reads. These are what `app/year/centre.tsx` uses.
  return {
    data,
    isPending: votes.isPending || roster.isPending,
    isError: votes.isError || roster.isError,
  };
}

/**
 * §8.1 / §9.2 — cast a Ballot, or move one.
 *
 * Moving a vote is an UPDATE rather than a second row, and writes no Feed row (§4.3).
 * Changing your mind about a family decision is not an event; it is thinking.
 *
 * Argument names are checked against `20260801000015_center_vote.sql` — and by
 * `lib/rpc-signatures.test.ts`, which exists because they are checked by nothing else
 * until a Member taps the button.
 */
export function useCastBallot(yearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ballot: {
      voteId: string;
      memberId: string;
      choiceMode?: 'shared' | 'personal' | null;
      proposalId?: string | null;
    }) => {
      const { error } = await supabase.rpc('cast_ballot', {
        vote_id: ballot.voteId,
        member_id: ballot.memberId,
        choice_mode: ballot.choiceMode ?? null,
        proposal_id: ballot.proposalId ?? null,
      });
      if (error !== null) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centre', yearId] }),
  });
}

/**
 * §9.1 — put a Goal forward. Max 3 per Member, enforced by a trigger.
 *
 * A direct insert rather than an RPC: `proposals` is one of the two tables the client
 * writes itself, and every rule about it lives in `enforce_proposal_rules()`.
 */
export function useProposeGoal(yearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (proposal: { voteId: string; memberId: string; text: string }) => {
      const { error } = await supabase.from('proposals').insert({
        vote_id: proposal.voteId,
        member_id: proposal.memberId,
        text: proposal.text.trim(),
      });
      if (error !== null) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centre', yearId] }),
  });
}

/**
 * Take a Proposal back — but only while nobody else has voted for it.
 *
 * The trigger refuses once someone has, and that refusal is the right one: withdrawing a
 * Proposal that has votes would silently discard them.
 */
export function useWithdrawProposal(yearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase.from('proposals').delete().eq('id', proposalId);
      if (error !== null) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centre', yearId] }),
  });
}

/**
 * §9.2 — the Organizer's tiebreak, recorded ahead of resolution.
 *
 * Recorded rather than applied, because `pg_cron` resolves on a deadline and cannot stop
 * to ask. If the Organizer never records one the earliest Proposal decides (§4.3), so
 * this is an option rather than an obligation and nothing waits for it.
 */
export function useSetTiebreak(yearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (choice: { voteId: string; proposalId: string | null }) => {
      const { error } = await supabase.rpc('set_organizer_tiebreak', {
        vote_id: choice.voteId,
        proposal_id: choice.proposalId,
      });
      if (error !== null) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centre', yearId] }),
  });
}
