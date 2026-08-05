/**
 * The Line animation (FRONTEND_DESIGN §5).
 *
 * > **Line** — 5 × 60ms. The five tiles pulse in sequence along the line's direction
 * > (diagonals corner to corner), then a 1px `clay` hairline draws through them.
 *
 * An overlay rather than a prop on `<Tile>`. Two reasons, and the second is the real one:
 *
 *   - `<Tile>` is memoised because it renders 25 times per board (§2), and threading a
 *     per-tile animation value through it would re-render all 25 sixty times a second for
 *     the three hundred milliseconds this runs.
 *   - The hairline is not a property of any square. It crosses five of them and the gaps
 *     between, so it can only be drawn by something that knows where the whole grid is —
 *     which is `src/ui/line.ts`, and which is why the arithmetic is not in here.
 *
 * Nothing here is interactive: `pointerEvents="none"` so the squares underneath keep
 * taking taps for the whole animation. A celebration that swallowed a tap would cost a
 * Member the Increment they were trying to log.
 */

import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { lineSegment, pulseOrder, cellSize, centreOf } from '../src/ui/line';
import { color, motion, radius } from '../theme/tokens';

/** §5's "1px `clay` hairline". 1.5 on the diagonal would be a second value to keep true. */
const HAIRLINE = 1;

/** How bright a pulsed square goes. Paper over moss reads as light, not as a colour. */
const PULSE_OPACITY = 0.55;

interface Props {
  /** Index into `LINES`. */
  lineIndex: number;
  /** The grid's measured width — the squares are `flex: 1` and have no fixed size (§3). */
  width: number;
  /** The same gap `<Board>` laid the rows out with, or the overlay lands between squares. */
  gap: number;
  /**
   * Changes every time the same Line should replay. A Line closes once (§13.2) so this is
   * usually the Milestone's id; it exists because remounting is the only way to restart an
   * `Animated` sequence, and a bare `lineIndex` would not change when the same line is
   * celebrated on a second Board.
   */
  runKey: string;
  /** §5: everything collapses to a 150ms crossfade, and the pulses do not run at all. */
  reduceMotion: boolean;
  /** Cleared when the drawing has finished so the caller can drop the overlay. */
  onDone: () => void;
}

export const LineDraw = memo(function LineDraw({
  lineIndex,
  width,
  gap,
  runKey,
  reduceMotion,
  onDone,
}: Props) {
  // One value per square plus one for the hairline. `useRef` rather than state: these are
  // driven by the animation and must not re-render the tree as they change.
  const pulses = useRef(pulseOrder(lineIndex).map(() => new Animated.Value(0))).current;
  const draw = useRef(new Animated.Value(0)).current;

  // `onDone` is called from inside the animation callback, which captures whatever the
  // prop was when the effect ran. Held in a ref so a caller that passes an inline arrow —
  // which is every caller — does not restart the animation on every render.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    for (const value of pulses) value.setValue(0);
    draw.setValue(0);

    const sequence = reduceMotion
      ? // §5's fallback: no travelling pulse, one crossfade to the end state.
        Animated.timing(draw, {
          toValue: 1,
          duration: motion.reduced.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      : Animated.sequence([
          Animated.stagger(
            motion.lineStep.duration,
            pulses.map((value) =>
              Animated.sequence([
                Animated.timing(value, {
                  toValue: PULSE_OPACITY,
                  duration: motion.lineStep.duration,
                  easing: Easing.out(Easing.quad),
                  useNativeDriver: true,
                }),
                Animated.timing(value, {
                  toValue: 0,
                  duration: motion.lineStep.duration * 2,
                  easing: Easing.out(Easing.quad),
                  useNativeDriver: true,
                }),
              ]),
            ),
          ),
          Animated.timing(draw, {
            toValue: 1,
            duration: motion.grow.duration,
            // The same curve §1's `motion.grow` names. Stated as an `Easing` because
            // `Animated` takes a function and the token is the CSS spelling of it.
            easing: Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: true,
          }),
        ]);

    sequence.start(({ finished }) => {
      // An interrupted run is a screen that went away. Reporting it done would clear an
      // overlay that has already been unmounted, and on a remount would skip the animation.
      if (finished) done.current();
    });
    return () => sequence.stop();
    // `runKey` is the restart signal; `pulses`/`draw` are refs and never change identity.
  }, [runKey, lineIndex, reduceMotion, pulses, draw]);

  // A width of zero is the first layout pass, before anything has been measured. Drawing
  // from it would put a zero-length hairline in the top-left corner for one frame.
  if (width <= 0) return null;

  const cell = cellSize(width, gap);
  const segment = lineSegment(lineIndex, width, gap, HAIRLINE);
  const positions = pulseOrder(lineIndex);

  return (
    <View pointerEvents="none" style={{ ...StyleSheetAbsoluteFill }}>
      {positions.map((position, i) => {
        const centre = centreOf(position, width, gap);
        return (
          <Animated.View
            key={position}
            style={{
              position: 'absolute',
              left: centre.x - cell / 2,
              top: centre.y - cell / 2,
              width: cell,
              height: cell,
              borderRadius: radius.tile,
              backgroundColor: color.paper,
              opacity: pulses[i],
            }}
          />
        );
      })}

      <Animated.View
        style={{
          position: 'absolute',
          left: segment.left,
          top: segment.top,
          width: segment.length,
          height: segment.thickness,
          // Clay, because a Line is the Family seeing something (§3's `<FeedRow>` seals a
          // Bingo in clay too). Never moss: moss is the ladder, and a Line is not a rung
          // on any tile's ladder.
          backgroundColor: color.clay,
          opacity: draw,
          transform: [
            { rotate: `${segment.rotation}deg` },
            // Drawn from its start rather than grown from the middle: the hairline follows
            // the pulses that just travelled the same way. `translateX` compensates for
            // `scaleX` being applied about the centre.
            {
              translateX: draw.interpolate({
                inputRange: [0, 1],
                outputRange: [-segment.length / 2, 0],
              }),
            },
            { scaleX: draw },
          ],
        }}
      />
    </View>
  );
});

/**
 * `StyleSheet.absoluteFillObject` inlined.
 *
 * Importing `StyleSheet` for one constant pulls a module whose only other use here would
 * be `create()`, which this file does not want: every style above depends on a measured
 * width and would have to be built per render anyway.
 */
const StyleSheetAbsoluteFill = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;
