/**
 * Slice 7 — Sharpening. The one place this app talks to a model.
 *
 * §7.1: this runs here, not on the client, because the Claude API key cannot ship in a
 * mobile app. That is the whole reason a server exists in an otherwise
 * client-plus-database architecture (ADR-0004).
 *
 * §7.5, restated because it is the requirement most likely to be "improved" away:
 * **Sharpening never blocks.** Every failure path below returns `200 { suggestions: [] }`
 * and the Member's own text stands. There is no error response in this function for
 * anything the Member could experience — not a timeout, not a refusal, not malformed
 * JSON, not a spent budget. Input is never lost; authoring is never blocked (§7.9).
 */

import Anthropic from 'npm:@anthropic-ai/sdk@^0.70.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import {
  SHARPEN_MODEL,
  SHARPEN_OUTPUT_SCHEMA,
  SHARPEN_SYSTEM_PROMPT,
  type Suggestion,
  buildSharpenUserMessage,
  normalizeSuggestions,
} from '../../../src/domain/sharpen.ts';

interface SharpenBody {
  text?: unknown;
  member_id?: unknown;
  year_id?: unknown;
}

/** The only response shape this function ever produces (§7.9, api.md §9). */
const ok = (suggestions: Suggestion[], reason?: string) =>
  new Response(JSON.stringify({ suggestions, reason: reason ?? null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const authorization = req.headers.get('Authorization');
  if (authorization === null) {
    return new Response('unauthorized', { status: 401 });
  }

  let body: SharpenBody;
  try {
    body = await req.json();
  } catch {
    return ok([], 'unreadable_request');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const memberId = typeof body.member_id === 'string' ? body.member_id : '';
  const yearId = typeof body.year_id === 'string' ? body.year_id : '';
  if (text.length === 0 || memberId === '' || yearId === '') {
    return ok([], 'incomplete_request');
  }

  // The caller's own JWT, so every read below is filtered by the same RLS policies the
  // client is subject to. This function is deliberately not a service-role backdoor
  // around the Family boundary (ADR-0004).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } } },
  );

  // §7.7 / §21.3: the remaining fraction of the Year is computed HERE, from the Year and
  // the Family's timezone, rather than taken from the request. A client-supplied
  // fraction would let anyone ask for a 300-walk target in December.
  const { data: year } = await supabase
    .from('years')
    .select('calendar_year, frozen_at, families(timezone)')
    .eq('id', yearId)
    .maybeSingle();

  // Zero rows means RLS said no — the caller cannot see this Year. Same empty response
  // as every other failure: an outsider learns nothing (api.md §9).
  if (year === null) return ok([], 'unavailable');

  // Whether the caller may act as this Member — checked HERE, before the model is called.
  //
  // It used to be checked only by consume_sharpen(), which runs after. Everything in
  // between trusted a `member_id` straight out of the request body, and
  // sharpen_budget_remaining() is SECURITY DEFINER with no guard of its own — an unknown
  // id simply reports the full 100. So an authenticated Member could loop with their own
  // year_id and any other member_id: every request called Opus 5, the 42501 came back
  // after the call and was swallowed as `budget_spent`, and §7.8's per-Member cap never
  // engaged. The bill is the part that has no ceiling.
  const { data: controlled } = await supabase.rpc('controlled_member_ids');
  const mayActAs =
    Array.isArray(controlled) &&
    controlled.some((row: unknown) =>
      typeof row === 'string' ? row === memberId : (row as { controlled_member_ids?: string })
        ?.controlled_member_ids === memberId,
    );
  // Same empty answer as every other refusal: an outsider learns nothing (api.md §9).
  if (!mayActAs) return ok([], 'unavailable');

  const { data: remainingBudget } = await supabase.rpc('sharpen_budget_remaining', {
    member_id: memberId,
    year_id: yearId,
  });
  if (typeof remainingBudget === 'number' && remainingBudget <= 0) {
    return ok([], 'budget_spent');
  }

  const timezone = (year as { families?: { timezone?: string } }).families?.timezone ?? 'UTC';
  const remainingYearFraction = remainingFractionOf(year.calendar_year as number, timezone);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (apiKey === undefined || apiKey === '') {
    // Misconfiguration is still not the Member's problem (§7.9).
    console.error('sharpen: ANTHROPIC_API_KEY is not set');
    return ok([], 'unavailable');
  }

  const anthropic = new Anthropic({ apiKey });

  let suggestions: Suggestion[] = [];
  try {
    const response = await anthropic.beta.messages.create(
      {
        model: SHARPEN_MODEL,
        max_tokens: 16000,
        // §7.2: effort low. This is an interactive field with a Member waiting, and
        // Opus 5 thinks by default — effort is the control, not disabling thinking.
        // (Disabling it on Opus 5 can leak `<thinking>` tags into the output, which is
        // exactly what structured outputs are here to avoid.)
        output_config: {
          effort: 'low',
          // §7.3: structured outputs, so the response validates. Do not parse prose.
          format: { type: 'json_schema', schema: SHARPEN_OUTPUT_SCHEMA },
        },
        // Opus 5's safety classifiers can decline a benign request; a fallback recovers
        // it server-side instead of costing the Member their suggestion.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          {
            type: 'text',
            text: SHARPEN_SYSTEM_PROMPT,
            // §7.4. Opus 5's cacheable minimum is 512 tokens and the prompt is written
            // to clear it; below that this marker is silently a no-op.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: buildSharpenUserMessage({ text, remainingYearFraction }),
          },
        ],
      } as Parameters<typeof anthropic.beta.messages.create>[0],
      { timeout: 30_000 },
    );

    // Check stop_reason BEFORE reading content. Opus 5 can return
    // stop_reason: 'refusal' with an EMPTY content array, and indexing content[0]
    // unconditionally throws. Branch on stop_reason, never on stop_details — that can
    // be null even on a refusal.
    if (response.stop_reason === 'refusal') {
      console.warn('sharpen: refused', response.stop_details?.category ?? 'uncategorised');
      return ok([], 'unavailable');
    }

    const block = response.content.find((b) => b.type === 'text');
    if (block === undefined || block.type !== 'text') return ok([], 'unavailable');

    suggestions = normalizeSuggestions(JSON.parse(block.text));
  } catch (error) {
    // Timeout, transport failure, malformed JSON — all the same to the Member (§7.9).
    console.error('sharpen: call failed', error);
    return ok([], 'unavailable');
  }

  if (suggestions.length === 0) return ok([], 'unavailable');

  // Spent only on a successful response (FRONTEND_DESIGN §4.2). A failure above returns
  // before reaching this line, so a Member never loses a sharpen to a timeout.
  //
  // `target_`-prefixed, because that is what the migration declares. The unprefixed names
  // were a silent total failure: PostgREST resolves an RPC by argument name, so the call
  // came back PGRST202 "could not find the function", the branch below swallowed it as
  // `budget_spent`, and the suggestion this function had just paid for was discarded. Every
  // successful Sharpen returned nothing, and §7.8's limit never incremented. The pgTAP
  // suite could not see it — it calls the function in SQL, where the names are right.
  //
  // `sharpen_budget_remaining` above is NOT prefixed, and that is correct: only
  // `consume_sharpen` renamed its parameters, to stop ON CONFLICT binding bare column
  // names to them.
  const { error: budgetError } = await supabase.rpc('consume_sharpen', {
    target_member_id: memberId,
    target_year_id: yearId,
  });
  // The suggestion is returned either way, and that is the whole lesson of the bug above.
  //
  // This branch used to `return ok([], 'budget_spent')`, which threw away a suggestion the
  // model had already been paid for — and that is exactly what kept the PGRST202 invisible
  // for so long: a bookkeeping failure looked like an ordinary spent budget. The limit was
  // already enforced before the call, so by this line the Member has earned the answer;
  // a counter that failed to increment is this function's problem, not theirs (§7.5).
  if (budgetError !== null) {
    console.warn('sharpen: budget not recorded after a successful call', budgetError.message);
  }

  return ok(suggestions);
});

/**
 * How much of a calendar Year remains, in the Family's timezone.
 *
 * Mirrors `remainingYearFraction` in src/domain/setup-window.ts. Kept local rather than
 * imported because that module is Node-shaped; if the rule changes, change both.
 */
const remainingFractionOf = (calendarYear: number, timeZone: string): number => {
  const start = startOfYear(calendarYear, timeZone);
  const end = startOfYear(calendarYear + 1, timeZone);
  const fraction = (end - Date.now()) / (end - start);
  return Math.min(1, Math.max(0, fraction));
};

const startOfYear = (year: number, timeZone: string): number => {
  const asIfUtc = Date.UTC(year, 0, 1);
  let ts = asIfUtc;
  for (let pass = 0; pass < 2; pass++) {
    ts = asIfUtc - zoneOffsetMs(new Date(ts), timeZone);
  }
  return ts;
};

const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const field = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const wallClock = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return wallClock - (instant.getTime() - (instant.getTime() % 1000));
};
