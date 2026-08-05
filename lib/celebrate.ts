/**
 * Making a celebration felt (FRONTEND_DESIGN §5).
 *
 * > Haptics: `light` on increment (both platforms) · `success` / `CONFIRM` on tile
 * > complete · five `light` impacts 60ms apart on Bingo.
 * >
 * > **Reduce Motion:** all four collapse to a 150ms crossfade … **Haptics stay** — they
 * > carry the reward and they are not motion.
 *
 * At the I/O boundary because it touches `expo-haptics` and the accessibility bus.
 * *Which* celebration to fire is `src/domain/celebration.ts`'s decision and is pure; this
 * only performs it.
 *
 * The Bingo pattern needs timers, so `celebrate` hands back a cancel. A screen that
 * unmounts mid-pattern must be able to stop it — five buzzes arriving after a Member has
 * navigated away belong to a screen that is no longer there.
 */

import { AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { CelebrationHaptic } from '../src/domain/celebration';

/** §5's "five `light` impacts 60ms apart". */
const BINGO_IMPACTS = 5;
const BINGO_GAP_MS = 60;

export function celebrate(haptic: CelebrationHaptic, announcement: string | null): () => void {
  // Announced first and unconditionally. A screen reader reads at its own pace and the
  // haptic pattern takes a quarter of a second; queuing the sentence behind it is how §6
  // A5's "announces once, on the tile that closed it" becomes "announces late".
  if (announcement !== null) AccessibilityInfo.announceForAccessibility(announcement);

  if (haptic === 'success') {
    // A rejection here is a handset without a Taptic Engine, which is not an error worth
    // surfacing — the celebration is still on the screen.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
    return () => undefined;
  }

  const timers: ReturnType<typeof setTimeout>[] = [];
  for (let i = 0; i < BINGO_IMPACTS; i += 1) {
    timers.push(
      setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }, i * BINGO_GAP_MS),
    );
  }
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
