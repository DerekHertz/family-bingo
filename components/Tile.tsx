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
import { color, radius, size, space, stroke } from '../theme/tokens';
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
  /** Omitted when no tile sheet exists to open — the square then renders inert (§6 A1). */
  onPress?: (() => void) | undefined;
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
      // With no handler the square is not a button and must not say it is: it stays one
      // focusable element carrying the same four facts, and announces as disabled rather
      // than inviting a tap that does nothing (§6 A1).
      disabled={onPress === undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: onPress === undefined }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: '100%',
        aspectRatio: 1,
        overflow: 'hidden',
        borderRadius: radius.tile,
        // A completed Tile is solid moss; everything else is the sunk well it grew from.
        backgroundColor:
          stage === 'complete' ? color.moss : shared ? color.clayTint : color.paperSunk,
        borderWidth: shared ? stroke.selected : stroke.hairline,
        // An unfilled Tile on a sealed Board is dashed — it is a Tile whose Goal has not
        // been written yet, not a mistake (§10.2, §3).
        borderStyle: goal === null ? 'dashed' : 'solid',
        borderColor: shared ? color.clay : color.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        // §5's Tap: 1 → 0.96 → 1, and it "fires on touch-down, not on server response".
        // A press state is the honest version of that with no animation driver — the
        // square answers the finger, and whether the row landed is the ring's business.
        // Opacity alone reads as *disabled* on a square that now actually does something.
        transform: [{ scale: pressed ? 0.96 : 1 }],
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {/* The shared centre's clay dot, top-centre (§3). Clay means family, nothing else.
          `size.dot` is the same 7pt as the Managed-Member dot and §4.7's clay bullets —
          "One dot size, not three" (tokens.ts). */}
      {shared ? (
        <View
          style={{
            position: 'absolute',
            top: space.xs,
            width: size.dot,
            height: size.dot,
            borderRadius: radius.pill,
            backgroundColor: color.clay,
          }}
        />
      ) : null}

      <TileGrowth stage={stage} progress={progress} />

      {stage === 'complete' ? (
        <Text
          // §6 A4: Dynamic Type runs to XXL everywhere except the board, which caps at L —
          // L being the default, so the multiplier is 1. The board's geometry is fixed at
          // 66.8pt and text that grew past it would push the check off the square. The
          // tile sheet carries the full range, so larger text is always one tap away.
          maxFontSizeMultiplier={1}
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
