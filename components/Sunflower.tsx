/**
 * The sunflower (FRONTEND_DESIGN §2).
 *
 * Eight rounded `View` petals and a disc — no SVG, no asset (§7.5). It renders 25 times
 * per Board on every launch, and views with a border radius are cheaper and themeable.
 *
 * Every number comes from `src/ui/sunflower.ts`, which is pure and unit-tested. Nothing
 * here computes geometry; if a proportion looks wrong, it is wrong there, where it can be
 * tested without a renderer.
 *
 * The petals widen from budding to complete — 26° to 32° — so the flower reads as
 * *opening* rather than merely changing colour. That widening is the whole completion
 * animation (§5).
 */

import { memo } from 'react';
import { View } from 'react-native';
import { discOf, petalsOf } from '../src/ui/sunflower';
import { color } from '../theme/tokens';

interface Props {
  size: number;
  /** `sun` while budding, `paper` once complete — never any other colour (§1.1). */
  petalColor: string;
  /** Angular width of each petal, in degrees of every 45° sector. */
  petalSpread: number;
}

/**
 * Memoised because a Board mounts 25 of these and a Tile re-renders on every increment.
 * The props are three primitives, so the default shallow compare is exactly right.
 */
export const Sunflower = memo(function Sunflower({ size, petalColor, petalSpread }: Props) {
  const petals = petalsOf(size, petalSpread);
  const disc = discOf(size);

  return (
    <View
      // Decorative: the Tile's own accessibility label says the stage in words, and eight
      // petals in the tree would say nothing anyone could use (§6).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {petals.map((petal, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: petal.width,
            height: petal.height,
            borderRadius: petal.borderRadius,
            backgroundColor: petalColor,
            // Rotate first, then push outward: after the rotation the petal's own x-axis
            // points away from the centre, which is why `width` is the radial length and
            // `height` is what spans the angle.
            transform: [{ rotate: `${petal.rotation}deg` }, { translateX: petal.offset }],
          }}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          width: disc.size,
          height: disc.size,
          borderRadius: disc.size / 2,
          backgroundColor: color.clayDeep,
        }}
      />
    </View>
  );
});
