/**
 * Whether the handset has asked for less movement (FRONTEND_DESIGN §5).
 *
 * > **Reduce Motion:** all four collapse to a 150ms crossfade between start and end state.
 * > **Haptics stay** — they carry the reward and they are not motion.
 *
 * A platform read rather than a pure rule, so it lives at the I/O boundary with the rest
 * of `lib/`. Nothing in `src/domain` may import it.
 *
 * Subscribed as well as read once: the setting is changed in Settings while the app is
 * backgrounded, and a Member who turns it on mid-year should not have to relaunch to be
 * believed.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  // Starts `false`, which is the honest default: the first answer is a promise, and
  // guessing `true` would make every animation in the app disappear for one frame.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      // A platform that cannot answer is not a reason to fail; it is a reason to animate.
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
