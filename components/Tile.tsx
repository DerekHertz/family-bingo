/**
 * One square of the Board (FRONTEND_DESIGN §2, §3 `<Tile>`).
 *
 * The square: its ground, its border, its one accessibility label, and the tap target.
 * The picture inside it is `<TileGrowth>`, which slice 11's `<TileSheet>` renders too.
 *
 * Which stage a Tile is on is derived from `COUNT(increments) / target` on render and
 * **never from a stored flag** (§12.1). A cached count and an append-only log drift; the
 * log is the source of truth.
 *
 * Past 100% nothing happens: 160 of 150 renders exactly as 150. Overshoot is celebrated
 * once, in Wrapped, and never on the board — where it would quietly reintroduce the
 * ladder §13.5 forbids.
 */

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { progressOf, stageOf } from '../src/domain/growth';
import { columnOf, rowOf } from '../src/domain/lines';
import { styles } from '../theme/fonts';
import { color, radius, space } from '../theme/tokens';
import { TileGrowth } from './TileGrowth';

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

export const Tile = memo(function Tile({
  position,
  goal,
  count,
  isCentre,
  centreMode,
  onPress,
}: Props) {
  // An empty Tile has no target to measure against, so it is dormant by definition rather
  // than by arithmetic — `stageOf(0, 1)` would agree, but only by coincidence.
  const stage = goal === null ? 'dormant' : stageOf(count, goal.target);
  const progress = goal === null ? 0 : progressOf(count, goal.target);
  const shared = isCentre && centreMode === 'shared';

  // §6: position, goal, progress, state — in that order, so a screen reader gives the
  // same four facts about every square and they arrive in a predictable place. Row and
  // column come from the domain, where the row-major rule of §5.4 is defined and tested;
  // recomputing them here is how the board and the line detector drift apart.
  const where = `Row ${rowOf(position) + 1}, column ${columnOf(position) + 1}`;
  const label =
    goal === null
      ? `${where}. Empty${isCentre ? ', the centre' : ''}.`
      : `${where}. ${goal.text}. ${count} of ${goal.target}${
          goal.unit === null ? '' : ` ${goal.unit}`
        }. ${stage === 'complete' ? 'Complete' : 'In progress'}.`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: '100%',
        aspectRatio: 1,
        overflow: 'hidden',
        borderRadius: radius.tile,
        // A completed Tile is solid moss; everything else is the sunk well it grew from.
        backgroundColor:
          stage === 'complete' ? color.moss : shared ? color.clayTint : color.paperSunk,
        borderWidth: shared ? 1.5 : 1,
        // An unfilled Tile on a sealed Board is dashed — it is a Tile whose Goal has not
        // been written yet, not a mistake (§10.2, §3).
        borderStyle: goal === null ? 'dashed' : 'solid',
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

      <TileGrowth stage={stage} progress={progress} />

      {stage === 'complete' ? (
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
      ) : null}
    </Pressable>
  );
});
