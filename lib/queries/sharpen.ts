/**
 * Sharpening, from the client's side — Slice 7 (PRD §7, FRONTEND_DESIGN §4.2).
 *
 * **§7.5 is the most important requirement in the PRD, and this file is where it is most
 * easily broken.** Sharpening never blocks. There is no validity check, no rejection, no
 * "your goal isn't specific enough". Every failure — timeout, refusal, malformed JSON,
 * spent budget, no network at all — resolves to zero suggestions and a reason, and the
 * Member's own text stands (§7.9).
 *
 * So this mutation **never rejects**. That is not laziness about error handling; it is the
 * requirement. A rejected mutation puts a screen into an error state, and there is no
 * error state here to put it into: the Goal is already valid, already saveable, and the
 * model's opinion was optional from the start.
 *
 * The API key is not here and must never be (§7.1). The Edge Function holds it, and it is
 * the reason a server exists in an otherwise client-plus-database architecture (ADR-0004).
 */

import { useMutation } from '@tanstack/react-query';
import type { Suggestion } from '../../src/domain/sharpen';
import { supabase } from '../supabase';

export type { Suggestion } from '../../src/domain/sharpen';

/**
 * Why there is no suggestion, when there is none.
 *
 * `budget_spent` is the only one the Member is told anything specific about, and even then
 * only as a fact about the Year rather than a refusal (§7.8's limit is 100 and exists
 * against a runaway loop, so a Member authoring 24 Goals will never see it).
 */
export type SharpenReason =
  | 'unavailable'
  | 'budget_spent'
  | 'unreadable_request'
  | 'incomplete_request'
  | null;

export interface SharpenResult {
  suggestion: Suggestion | null;
  reason: SharpenReason;
}

export interface SharpenInput {
  text: string;
  memberId: string;
  yearId: string;
}

/**
 * Ask for one sharper phrasing of a Goal.
 *
 * One suggestion, never a menu (§4.2) — the Edge Function already truncates to one, and
 * this reads only the first, so a change on either side cannot quietly produce a list.
 *
 * The Year's remaining fraction (§7.7) is deliberately **not** sent. The Edge Function
 * computes it from the Year and the Family's timezone, because a client-supplied fraction
 * would let anyone ask for a 300-walk target in December.
 */
export function useSharpen() {
  return useMutation({
    mutationFn: async ({ text, memberId, yearId }: SharpenInput): Promise<SharpenResult> => {
      const { data, error } = await supabase.functions.invoke<{
        suggestions?: Suggestion[];
        reason?: SharpenReason;
      }>('sharpen', { body: { text: text.trim(), member_id: memberId, year_id: yearId } });

      // Not thrown. A function that is not deployed, a device with no signal, and a model
      // that timed out are the same event to a Member who is trying to write a goal:
      // nothing came back, and their words are fine as they are (§7.9).
      if (error !== null) return { suggestion: null, reason: 'unavailable' };

      const suggestion = data?.suggestions?.[0] ?? null;
      return { suggestion, reason: suggestion === null ? (data?.reason ?? 'unavailable') : null };
    },
    // One attempt. The Edge Function already swallows its own failures and answers 200,
    // so a rejection here means the request never landed — and a Member watching a field
    // should not wait through two more backoffs to be told what the screen can say now.
    retry: false,
  });
}
