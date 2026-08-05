/**
 * The growth ladder, drawn (FRONTEND_DESIGN §2).
 *
 * Separated from `<Tile>` because the ladder and the square are two different things: the
 * square is a pressable with a border, a ground colour and an accessibility label, and this
 * is the picture inside it. Slice 11's `<TileSheet>` shows the same five stages at 92pt
 * behind its ring, and a stage rendered twice from two copies of the arithmetic is a stage
 * that will disagree with itself.
 *
 * Purely presentational: it takes a stage and a progress and draws them. It does not decide
 * which stage a Tile is on — `stageOf()` does, from `COUNT(increments) / target`, on every
 * render and never from a stored flag (§12.1).
 *
 * The five stages, and the transitions are the point:
 *
 *   - `dormant`   an empty well. Nothing else.
 *   - `seeded`    a seed resting on the soil line.
 *   - `sprouting` a stem with **one** leaf, always one.
 *   - `budding`   the head opens at the stem tip — the only warm mark on an unfinished
 *                 board, which is why `sun` exists and why it is used nowhere else.
 *   - `complete`  stem and leaf **fall away**; a wide-petalled flower on solid moss.
 */

import { memo } from 'react';
import type { Stage } from '../src/domain/growth';
import { HEAD_SIZE, PETAL_SPREAD, stemOf } from '../src/ui/sunflower';
import { color } from '../theme/tokens';
import { Sunflower } from './Sunflower';
import { View } from 'react-native';

interface Props {
  stage: Stage;
  /** 0–1, already clamped by `progressOf`. Drives the soil fill and the stem's length. */
  progress: number;
}

/** §2's leaf glyph: two opposite corners rounded, tilted. No asset. */
function Leaf({ size, bottom }: { size: number; bottom: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom,
        left: '50%',
        width: size,
        height: size,
        marginLeft: -9,
        backgroundColor: color.moss,
        borderTopLeftRadius: size,
        borderBottomRightRadius: size,
        transform: [{ rotate: '-15deg' }],
      }}
    />
  );
}

/**
 * The soil creeping up the well behind the plant.
 *
 * `mossTint`, never `moss`: the solid colour is what a *completed* Tile is, and a Tile at
 * 95% that already looks finished takes the meaning out of finishing.
 */
function Soil({ progress }: { progress: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: `${progress * 100}%`,
        backgroundColor: color.mossTint,
      }}
    />
  );
}

/**
 * §2's 1px/7px diagonal hatch at 10% white, and the fourth of completion's four cues.
 *
 * §6 A2 is a test, not a preference: *"Completion carries four independent cues: fill,
 * silhouette, check, hatch. Test by desaturating a board screenshot; if you can't count
 * the finished tiles, it fails."* Fill and silhouette are both colour, so desaturated they
 * collapse into one — the hatch and the check are what survive it.
 *
 * Fixed-pitch bars rather than anything sized to the Tile: the pitch IS the spec, and a
 * hatch that stretched with the square would be a different hatch on an SE. The Tile clips
 * with `overflow: hidden`, so drawing past the edges costs nothing.
 */
const HATCH_PITCH = 7;
const HATCH_BARS = 16;

function Hatch() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {Array.from({ length: HATCH_BARS }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: i * HATCH_PITCH,
            // Overhangs top and bottom so the 45° rotation still reaches both corners.
            top: -HATCH_PITCH * HATCH_BARS,
            bottom: -HATCH_PITCH * HATCH_BARS,
            width: 1,
            // A token, not a literal `rgba()`: tokens.ts owns every colour, and one
            // written here is a light-mode value that can never flip (§1.2).
            backgroundColor: color.completionHatch,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ))}
    </View>
  );
}

export const TileGrowth = memo(function TileGrowth({ stage, progress }: Props) {
  if (stage === 'dormant') return null;

  if (stage === 'complete') {
    // Stem and leaf fall away — leaves are for growing, the flower is for arriving. Do not
    // add a leaf back to "balance" it (§2).
    return (
      <>
        <Hatch />
        <Sunflower
          size={HEAD_SIZE.complete}
          petalColor={color.paper}
          petalSpread={PETAL_SPREAD.complete}
        />
      </>
    );
  }

  if (stage === 'seeded') {
    return (
      <>
        <Soil progress={progress} />
        <View
          style={{
            position: 'absolute',
            bottom: 9,
            width: 9,
            height: 12,
            // §2 says border-radius 50% — an ellipse, which on a 9×12 is not the same
            // shape as a 6pt radius. That one draws a stadium with flat sides.
            borderRadius: '50%',
            backgroundColor: color.ink3,
          }}
        />
      </>
    );
  }

  // `sprouting` and `budding` are one drawing with one extra mark, not two drawings — the
  // head opens at the tip of a stem that was already there, and separating them would let
  // the stem jump at the 82% boundary.
  const stem = stemOf(progress);
  return (
    <>
      <Soil progress={progress} />
      <View
        style={{
          position: 'absolute',
          bottom: 9,
          width: 2,
          height: stem.stemHeight,
          backgroundColor: color.moss,
        }}
      />
      {/* One leaf. Always one — a second never reads as a pair at tile scale and it
          competes with the head at 82% (§2). */}
      <Leaf size={stem.leafSize} bottom={stem.leafBottom} />
      {stage === 'budding' ? (
        <View style={{ position: 'absolute', bottom: stem.headBottom }}>
          <Sunflower
            size={HEAD_SIZE.budding}
            petalColor={color.sun}
            petalSpread={PETAL_SPREAD.budding}
          />
        </View>
      ) : null}
    </>
  );
});
