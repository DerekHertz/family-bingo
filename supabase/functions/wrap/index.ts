/**
 * Slice 20 — the Awards half of Wrapped.
 *
 * §20.7's rules are load-bearing: Awards sit on unrelated axes, **every Member must
 * receive at least one**, there is never a single ordered list, and ties award both. The
 * algorithm that satisfies them — assignAwards() — is subtle in ways that are easy to
 * break and hard to notice: a coverage phase where the most constrained Member picks
 * first, ranks rather than score ratios so that negated axes cannot invert, ties sharing a
 * rank. It is exhaustively unit-tested.
 *
 * So it is not transcribed into PL/pgSQL. The database computes the stats, which are
 * ordinary aggregation; this reads them, calls the tested function, and hands the result
 * to finalize_wrapped(), which writes the Awards and the pushes in one transaction.
 *
 * The same split as `sharpen`, for the same reason: the interesting logic lives in
 * src/domain where it can be tested without a database.
 *
 * Invoked by `pg_cron` after the freeze sweep. Idempotent — finalize_wrapped() returns 0
 * for a Wrapped that already has Awards, so a second run sends no second round of pushes.
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { assignAwards, type MemberYearStats } from '../../../src/domain/awards.ts';

interface StatsRow {
  member_id: string;
  increments: number;
  biggest_month_increments: number;
  comeback_delta: number | null;
  median_gap_days: number | null;
  longest_goal_span_days: number | null;
  photos: number;
  notes: number;
  first_bingo_at: string | null;
  most_exceeded_ratio: number | null;
  lines_completed: number;
}

/** The database's row shape, in the units assignAwards() compares. */
const toStats = (row: StatsRow): MemberYearStats => ({
  memberId: row.member_id,
  increments: Number(row.increments),
  biggestMonthIncrements: Number(row.biggest_month_increments),
  medianGapDays: row.median_gap_days === null ? null : Number(row.median_gap_days),
  longestGoalSpanDays:
    row.longest_goal_span_days === null ? null : Number(row.longest_goal_span_days),
  // Computed in SQL now. It used to be synthesised here from best-minus-worst, which put
  // an Award's own input outside the materialized Wrapped that §20.2 froze so it would be
  // reproducible — and read "worst" as the quietest ACTIVE month, so a Member idle from
  // February to November had their comeback understated to nothing.
  comebackDelta:
    row.comeback_delta === null || Number(row.comeback_delta) <= 0
      ? null
      : Number(row.comeback_delta),
  photos: Number(row.photos),
  notes: Number(row.notes),
  firstBingoAt: row.first_bingo_at === null ? null : new Date(row.first_bingo_at),
  mostExceededRatio:
    row.most_exceeded_ratio === null ? null : Number(row.most_exceeded_ratio),
  completedALine: Number(row.lines_completed) > 0,
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  if (req.headers.get('Authorization') === null) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Every Wrapped that has cards but no Awards. That is the whole work queue, and it is a
  // query rather than a parameter so that a Wrapped whose Awards failed to write is
  // retried on the next pass instead of staying half-finished forever.
  const { data: pending, error } = await db
    .from('wrapped')
    .select('id, year_id, wrapped_awards(id)')
    .limit(50);

  if (error !== null) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const owed = (pending ?? []).filter(
    (w) => ((w as { wrapped_awards: unknown[] }).wrapped_awards ?? []).length === 0,
  );

  let finalized = 0;
  const failures: { year_id: string; error: string }[] = [];

  for (const wrapped of owed) {
    const yearId = (wrapped as { year_id: string }).year_id;

    const { data: rows, error: statsError } = await db
      .rpc('member_year_stats', { target_year_id: yearId });

    if (statsError !== null || rows === null) {
      failures.push({ year_id: yearId, error: statsError?.message ?? 'no stats' });
      continue;
    }

    const awards = assignAwards((rows as StatsRow[]).map(toStats)).map((award) => ({
      member_id: award.memberId,
      axis: award.axis,
      label: award.label,
      // isSuperlative decides the wording, not a placing. A card that read "2nd most
      // increments" would be the ladder §13.5a forbids.
      detail: { ...award.detail, superlative: award.isSuperlative },
    }));

    const { error: finalizeError } = await db
      .rpc('finalize_wrapped', { year_id: yearId, awards });

    if (finalizeError !== null) {
      failures.push({ year_id: yearId, error: finalizeError.message });
      continue;
    }
    finalized += 1;
  }

  return Response.json({ finalized, failed: failures.length, failures });
});
