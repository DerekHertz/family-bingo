/**
 * The tile sheet's progress ring (FRONTEND_DESIGN §3).
 *
 * > 92pt conic ring, `moss` on `paperSunk`, `count` at 23pt/700 and `of {target}` at 11pt
 * > inside. **This is the one place the exact number appears large.**
 *
 * That sentence is the whole reason this component is allowed to exist. Everywhere else a
 * number this size would be a score, and §13.5 forbids scores — but inside the sheet a
 * Member is looking at their own Goal and nobody else's, so the count is information
 * rather than a rank.
 *
 * No SVG and no `conic-gradient` (§7.5, and React Native has neither): two half-disc
 * wedges pinned at the centre and rotated, with a hole punched through in the sheet's own
 * colour. All the arithmetic is in `src/ui/ring.ts`, where it is tested without a renderer.
 */

import { memo } from 'react';
import { Text, View } from 'react-native';
import { countSummary } from '../src/domain/increment';
import { ringBox, sweepOf } from '../src/ui/ring';
import { styles } from '../theme/fonts';
import { color } from '../theme/tokens';

interface Props {
  count: number;
  target: number;
  /** 0–1, from `progressOf` — already clamped, and not recomputed here. */
  progress: number;
  /** The ground the hole is punched in. The ring is drawn *on* the sheet, not on paper. */
  ground?: string;
  /**
   * The unfilled part. `paperSunk` everywhere except the shared Centre, which §4.3 gives a
   * `clayTint` track because clay means family. **The fill is never anything but `moss`** —
   * progress is progress on every square, and tinting it would make the Centre's the only
   * progress that looked different from progress.
   */
  track?: string;
  /**
   * §4.3: the Centre shows "no counts, no ordering" (§13.5). A Family Goal has no Target
   * to count toward — it is marked done — so "0 of 1" would be a number invented to fill
   * the hole.
   */
  showCount?: boolean;
}

/** One half-disc, pinned at the ring's centre so rotation sweeps rather than orbits. */
function Wedge({
  box,
  side,
  rotation,
}: {
  box: ReturnType<typeof ringBox>;
  side: 'left' | 'right';
  rotation: number;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        [side]: 0,
        width: box.wedgeWidth,
        height: box.size,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: box.wedgeWidth,
          height: box.size,
          backgroundColor: color.moss,
          // Rounded on the outer edge only — together the two halves make the circle.
          borderTopLeftRadius: side === 'right' ? 0 : box.radius,
          borderBottomLeftRadius: side === 'right' ? 0 : box.radius,
          borderTopRightRadius: side === 'right' ? box.radius : 0,
          borderBottomRightRadius: side === 'right' ? box.radius : 0,
          // The pivot is the ring's centre, which is the wedge's inner edge — not its own
          // middle. Rotating about the middle would send the wedge into orbit.
          transformOrigin: side === 'right' ? 'left center' : 'right center',
          // **Minus 180, and that is the whole trick.** At rest each wedge is swung fully
          // out of its own clip; rotating it brings the sweep in from twelve o'clock. Left
          // at `rotation`, the wedge instead *starts* covered and uncovers from the top —
          // so 30% drew its arc from four o'clock to six, the last 30% of the ring rather
          // than the first. It looked plausible in isolation and was only obviously wrong
          // beside the count.
          transform: [{ rotate: `${rotation - 180}deg` }],
        }}
      />
    </View>
  );
}

export const ProgressRing = memo(function ProgressRing({
  count,
  target,
  progress,
  ground = color.paperRaised,
  track = color.paperSunk,
  showCount = true,
}: Props) {
  const box = ringBox();
  const sweep = sweepOf(progress);

  return (
    <View
      accessible
      // One element, one sentence. Twelve rotated views in the tree would say nothing
      // anyone could use, and the count is the whole point (§6).
      accessibilityLabel={
        showCount ? countSummary(count, target) : progress >= 1 ? 'Done' : 'Not done yet'
      }
      style={{
        width: box.size,
        height: box.size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* The track. `paperSunk` is the same well the dormant Tile is (§2) — the ring is
          the Tile's own progress, said precisely. */}
      <View
        style={{
          position: 'absolute',
          width: box.size,
          height: box.size,
          borderRadius: box.radius,
          backgroundColor: track,
        }}
      />

      {/* The right wedge always sweeps the first half turn. The left is not rendered below
          halfway: unrotated it would cover its whole side, so 10% would read as 50%. */}
      <Wedge box={box} side="right" rotation={sweep.rightRotation} />
      {sweep.pastHalf ? <Wedge box={box} side="left" rotation={sweep.leftRotation} /> : null}

      {/* The hole, in the sheet's ground rather than `paper` — a ring drawn on the wrong
          colour reads as a disc with a coin on it. */}
      <View
        style={{
          position: 'absolute',
          width: box.holeSize,
          height: box.holeSize,
          borderRadius: box.holeRadius,
          backgroundColor: ground,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {showCount ? (
          <>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              // The hole is a fixed 76pt and the ring's geometry is what §3 specifies, so
              // this one number cannot grow with Dynamic Type without spilling out of it.
              // Everything else in the sheet does (§6 A4).
              maxFontSizeMultiplier={1.2}
              style={{ ...styles.ringCount, color: color.ink }}
            >
              {count}
            </Text>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              maxFontSizeMultiplier={1.2}
              style={{ ...styles.ringOf, color: color.ink2 }}
            >
              of {target}
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
});
