/**
 * Saying something once, out loud and on screen (FRONTEND_DESIGN §6 A6, §0.3).
 *
 * Every screen in this app that can refuse a Member holds one line of plain words and has
 * to make sure it is *heard*. That is two calls, always the same two, and nine screens had
 * written them out by hand — four as a local `say()`, five expanded inline at the point of
 * failure, where the second call is the one that gets forgotten.
 *
 * ```ts
 * setTrouble(message);
 * AccessibilityInfo.announceForAccessibility(message);
 * ```
 *
 * **The second line is not a nicety.** `accessibilityLiveRegion` is Android-only, so
 * without `announceForAccessibility` a VoiceOver Member is told nothing at all — the one
 * piece of feedback the screen has is silent. It is also why `<Trouble live>` exists as a
 * prop rather than a constant: on Android the two together announce twice, so a screen that
 * uses this hook AND a live region has to choose (see `components/Screen.tsx`).
 *
 * Lives in `lib/` because it touches `AccessibilityInfo`, which is I/O — the architecture
 * rule in docs/HANDOFF.md. `components/` is reusable and does not fetch; `src/domain` may
 * not import react-native at all.
 *
 * There is no colour here and there will not be one. §1.1: there is no red in this palette,
 * and trouble is `ink2` and plain words (`<Trouble>` owns that half).
 */

import { useCallback, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export interface Announce {
  /** The sentence currently on screen, or `null`. Hand it to `<Trouble>`. */
  trouble: string | null;
  /** Put it on screen and say it aloud. */
  say: (message: string) => void;
  /**
   * Take it back.
   *
   * Called on success, so a refusal cannot outlive the thing it refused — a Member who
   * fixes what was wrong and succeeds should not still be reading why they failed.
   * Deliberately silent: there is nothing to announce about a sentence going away.
   */
  clear: () => void;
}

export function useAnnounce(): Announce {
  const [trouble, setTrouble] = useState<string | null>(null);

  // Stable identities, so a screen may pass either into a memoised child or an effect
  // without it re-running on every keystroke somewhere else on the page.
  const say = useCallback((message: string) => {
    setTrouble(message);
    AccessibilityInfo.announceForAccessibility(message);
  }, []);
  const clear = useCallback(() => setTrouble(null), []);

  return { trouble, say, clear };
}
