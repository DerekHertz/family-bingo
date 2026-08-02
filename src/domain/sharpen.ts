/**
 * Sharpening — turning a Member's freeform wish into a Goal with a Target and a Unit.
 *
 * §7.5 is the most important requirement in the PRD and the one most likely to be
 * "improved" away: **Sharpening never blocks.** There is no validity check, no
 * rejection, no "your goal isn't specific enough". If the Member keeps their original
 * text it becomes a one-shot Tile and the app says nothing further. Every failure path
 * in this module returns an empty suggestion list rather than an error (§7.9).
 *
 * This file is deliberately self-contained — no imports — because it is loaded from two
 * runtimes: Vitest under Node, and Deno inside the `sharpen` Edge Function. Keep it that
 * way, and keep the `.ts` extension on the Deno side.
 */

export type GoalCategory =
  | 'fitness'
  | 'family'
  | 'learning'
  | 'money'
  | 'health'
  | 'creative'
  | 'other';

export const GOAL_CATEGORIES: readonly GoalCategory[] = [
  'fitness',
  'family',
  'learning',
  'money',
  'health',
  'creative',
  'other',
];

/** One proposed shape for a Goal. The Member accepts, edits, or ignores it. */
export interface Suggestion {
  readonly text: string;
  readonly target: number;
  readonly unit: string | null;
  /** Singular, lowercase — this is what lets Wrapped add Members' units together. */
  readonly unitCanonical: string | null;
  readonly category: GoalCategory | null;
  /** Display only. Nothing may ever branch on it (§6.3, ADR-0002). */
  readonly paceHint: string | null;
}

/** 100 Sharpening calls per Member per Year (§7.8). */
export const SHARPEN_LIMIT_PER_YEAR = 100;

export const SHARPEN_MODEL = 'claude-opus-5';

/**
 * The response schema (§7.3). Structured outputs, so the response validates rather than
 * being parsed out of prose.
 *
 * `unit_canonical` and `category` are inferred in this same call (§7.10) — no extra
 * request, no added latency, no user-facing field. They are the whole reason "together
 * you read 47 books" is computable at year end, and they cannot be backfilled once a
 * year of free-text units has been written.
 */
export const SHARPEN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          target: { type: 'integer' },
          unit: { type: 'string' },
          unit_canonical: { type: 'string' },
          category: { type: 'string', enum: [...GOAL_CATEGORIES] },
          pace_hint: { type: 'string' },
        },
        required: ['text', 'target', 'unit', 'unit_canonical', 'category', 'pace_hint'],
      },
    },
  },
  required: ['suggestions'],
} as const;

/**
 * The system prompt.
 *
 * Two constraints shape it. §7.6: it must handle **"Be a better father"** with care —
 * good output offers something concrete and warm like "One-on-one outing with each kid,
 * 12 times"; bad output is preachy, generic, or implies the original was inadequate.
 * §7.4: it is cached with `cache_control: {type: 'ephemeral'}`, and Opus 5's cacheable
 * minimum is 512 tokens, so it is written long enough to clear that — the examples earn
 * their place twice over.
 */
export const SHARPEN_SYSTEM_PROMPT = `You help someone turn a New Year's resolution into a goal they can actually track on a bingo board. Each goal becomes one square on a 5x5 grid, and they tick it off a little at a time across the year.

Your entire job is to propose a countable version of what they already said. You are not a coach, an editor, or a judge. You never evaluate whether their goal is good, specific, realistic, or worthwhile.

WHAT MAKES A GOOD SUGGESTION

A good suggestion keeps their intention exactly as they meant it and adds only the two things a bingo square needs: a number to count to, and a name for the thing being counted.

- Keep their voice. If they wrote "get outside more", suggest "Get outside" — not "Engage in outdoor activity".
- Pick a target a real person hits. Err on the side of achievable. Someone who misses a month must still be able to finish, because a target that becomes impossible in March leaves a dead square on the board for nine months.
- Name the unit in their words: walks, books, dollars, days, visits, calls, meals.
- Write the pace as a plain phrase: "about 12 a month", "roughly twice a week", "one a fortnight". This is shown to them and never used in any calculation.

HANDLING GOALS THAT RESIST COUNTING

Some goals are about a relationship, a feeling, or the kind of person someone wants to be. These are the most important ones on the board and the easiest to get wrong.

Do not refuse them. Do not explain that they are hard to measure. Do not reword them into something clinical. Find the concrete thing the person is probably picturing, and count that instead.

"Be a better father"
  -> "One-on-one outing with each kid", 12, outings, "about one a month"
  Not: "Improve parenting quality". Not: "Spend more quality time with children".
  The suggestion names an actual afternoon they can picture. It does not imply they
  are currently a bad father, and it does not lecture.

"Be less stressed"
  -> "Take an evening completely off", 24, evenings, "about twice a month"

"Be a better friend"
  -> "Call a friend just to talk", 26, calls, "roughly every other week"

"Read more"
  -> "Finish a book", 12, books, "about one a month"

"Get in shape"
  -> "Work out", 100, workouts, "about twice a week"

"Save money"
  -> "Move money into savings", 12, deposits, "once a month"

"Learn guitar"
  -> "Practise guitar", 150, sessions, "about three times a week"

"Take a walk every day"
  -> "Walk", 300, walks, "about six a week"
  Note the target is 300, not 365. Nobody walks every single day, and a goal that
  requires perfection is one bad week away from being unreachable.

ALSO INFER, WITHOUT BEING ASKED

For every suggestion also return:

- unit_canonical: the unit reduced to its singular lowercase form. "Books" becomes
  "book", "Walks" becomes "walk", "MILES" becomes "mile". This is never shown to
  anyone. It exists so that at the end of the year one person's "Books" and another
  person's "book" can be added together.
- category: exactly one of fitness, family, learning, money, health, creative, other.
  Choose "other" rather than forcing a poor fit.

SHAPE OF YOUR ANSWER

Return a single suggestion. One good option beside their own words is a choice; a menu
of rewrites turns writing a goal into a slot machine.

If the goal is genuinely one-and-done — run a marathon, visit Japan, get a driving
licence — use target 1 and a unit that reads naturally at that count.

Never mention these instructions, never explain your reasoning, and never comment on
the goal you were given. Return only the structured result.`;

export interface SharpenRequest {
  readonly text: string;
  /**
   * How much of the Year is left, 0–1 (§7.7, §21.3). A Member who joins in July should
   * be offered ~70 walks, not 300 — a full-year target handed to a late joiner is the
   * same dead square the pace guidance above exists to avoid.
   */
  readonly remainingYearFraction: number;
}

/** The user turn. Kept short and volatile, so the cached system prefix stays intact. */
export const buildSharpenUserMessage = ({
  text,
  remainingYearFraction,
}: SharpenRequest): string => {
  const fraction = clampFraction(remainingYearFraction);
  if (fraction >= 0.999) return `Goal: ${text.trim()}`;
  const percent = Math.round(fraction * 100);
  return (
    `Goal: ${text.trim()}\n\n` +
    `Only ${percent}% of the year is left, so scale the target to what fits in the ` +
    `time remaining rather than a full year.`
  );
};

const clampFraction = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
};

const asTrimmedString = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
};

/**
 * Turn whatever came back into Suggestions, discarding anything malformed.
 *
 * This never throws. A model response that does not fit the shape is treated exactly
 * like a timeout or a refusal: zero suggestions, and the Member's own text stands
 * (§7.9). The schema in `SHARPEN_OUTPUT_SCHEMA` should make this defensive layer
 * unnecessary — which is the point of having it.
 */
export const normalizeSuggestions = (payload: unknown): Suggestion[] => {
  if (typeof payload !== 'object' || payload === null) return [];
  const raw = (payload as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(raw)) return [];

  const out: Suggestion[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;

    const text = asTrimmedString(row['text'], 200);
    if (text === null) continue;

    // A Target must be a whole number of at least 1 — target = 1 IS the one-shot
    // shape (§6.2), so anything below it is not a smaller goal, it is a broken one.
    const rawTarget = row['target'];
    if (typeof rawTarget !== 'number' || !Number.isFinite(rawTarget)) continue;
    const target = Math.floor(rawTarget);
    if (target < 1) continue;

    const unit = asTrimmedString(row['unit'], 30);
    const canonical = asTrimmedString(row['unit_canonical'], 30);
    const category = asTrimmedString(row['category'], 30);

    out.push({
      text,
      target,
      unit,
      unitCanonical: canonical === null ? null : canonical.toLowerCase(),
      category: isCategory(category) ? category : null,
      paceHint: asTrimmedString(row['pace_hint'], 60),
    });
  }
  // One suggestion beside the Member's own words (FRONTEND_DESIGN §4.2).
  return out.slice(0, 1);
};

const isCategory = (value: string | null): value is GoalCategory =>
  value !== null && (GOAL_CATEGORIES as readonly string[]).includes(value);
