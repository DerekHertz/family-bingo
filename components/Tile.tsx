/**
 * One square of the Board (FRONTEND_DESIGN §2, §3 `<Tile>`).
 *
 * The growth ladder is the most important piece of visual logic in the app, and every bit
 * of it is derived from `COUNT(increments) / target` on render — **never a stored flag**
 * (§12.1). A cached count and an append-only log drift; the log is the source of truth.
 *
 * Five stages, and the transitions are the point:
 *
 *   - `dormant`   an empty well. Nothing else.
 *   - `seeded`    a seed resting on the soil line.
 *   - `sprouting` a stem with **one** leaf, always one.
 *   - `budding`   the head opens at the stem tip — the only warm mark on an unfinished
 *                 board, which is why `sun` exists and why it is used nowhere else.
 *   - `complete`  stem and leaf **fall away**; a wide-petalled flower on solid moss.
 *
 * Past 100% nothing happens: 160 of 150 renders exactly as 150. Overshoot is celebrated
 * once, in Wrapped, and never on the board — where it would quietly reintroduce the
 * ladder §13.5 forbids.
 */

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { progressOf, stageOf } from '../src/domain/growth';
import { stemOf } from '../src/ui/sunflower';
import { HEAD_SIZE, PETAL_SPREAD } from '../src/ui/sunflower';
import { styles } from '../theme/fonts';
import { color, radius, space } from '../theme/tokens';
import { Sunflower } from './Sunflower';

export interface TileGoal {
  text: string;
  target: number;
  unit: string | null;
}

interface Props {
  position: number;
  /** `null` on a Tile nobody filled before the Board sealed — legitimate (§10.2). */
  goal: TileGoal | null;
  count: number;
  isCentre: boolean;
  centreMode: 'shared' | 'personal' | 'undecided';
  onPress: () => void;
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

export const Tile = memo(function Tile({
  position,
  goal,
  count,
  isCentre,
  centreMode,
  onPress,
}: Props) {
  const target = goal?.target ?? 1;
  const stage = goal === null ? 'dormant' : stageOf(count, target);
  const progress = goal === null ? 0 : progressOf(count, target);
  const stem = stemOf(progress);
  const shared = isCentre && centreMode === 'shared';

  // §6: position, goal, progress, state — in that order, so a screen reader gives the
  // same four facts about every square and they arrive in a predictable place.
  const where = `Row ${Math.floor(position / 5) + 1}, column ${(position % 5) + 1}`;
  const label =
    goal === null
      ? `${where}. Empty${isCentre ? ', the centre' : ''}.`
      : `${where}. ${goal.text}. ${count} of ${target}${
          goal.unit === null ? '' : ` ${goal.unit}`
        }. ${stage === 'complete' ? 'Complete' : 'In progress'}.`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        aspectRatio: 1,
        overflow: 'hidden',
        borderRadius: radius.tile,
        // A completed Tile is solid moss; everything else is the sunk well it grew from.
        backgroundColor:
          stage === 'complete' ? color.moss : shared ? color.clayTint : color.paperSunk,
        borderWidth: shared ? 1.5 : 1,
        // An unfilled Tile on a sealed Board is dashed — it is a Tile whose Goal has not
        // been written yet, not a mistake (§10.2, §3).
        borderStyle: goal === null && stage === 'dormant' ? 'dashed' : 'solid',
        borderColor: shared ? color.clay : color.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {/* The shared centre's clay dot, top-centre (§3). Clay means family, nothing else. */}
      {shared ? (
        <View
          style={{
            position: 'absolute',
            top: space.xs,
            width: 7,
            height: 7,
            borderRadius: radius.pill,
            backgroundColor: color.clay,
          }}
        />
      ) : null}

      {stage === 'seeded' ? (
        <>
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
          <View
            style={{
              position: 'absolute',
              bottom: 9,
              width: 9,
              height: 12,
              borderRadius: 6,
              backgroundColor: color.ink3,
            }}
          />
        </>
      ) : null}

      {stage === 'sprouting' || stage === 'budding' ? (
        <>
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
      ) : null}

      {stage === 'complete' ? (
        <>
          {/* Stem and leaf fall away — leaves are for growing, the flower is for
              arriving. Do not add a leaf back to "balance" it (§2). */}
          <Sunflower
            size={HEAD_SIZE.complete}
            petalColor={color.paper}
            petalSpread={PETAL_SPREAD.complete}
          />
          <Text
            style={{
              ...styles.label,
              position: 'absolute',
              top: 2,
              right: 4,
              color: color.paper,
            }}
          >
            ✓
          </Text>
        </>
      ) : null}
    </Pressable>
  );
});
