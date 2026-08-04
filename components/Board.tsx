/**
 * The Board — 25 Tiles, 5 across (FRONTEND_DESIGN §3 `<Board>`).
 *
 * **Never scrolls, never shrinks, never paginates.** If the content below it does not
 * fit, that content scrolls *under* a pinned board — not the other way round. The whole
 * point of a bingo board is seeing all of it at once.
 *
 * Positions are row-major and 0-indexed: position `p` is row `p / 5`, column `p % 5`
 * (§5.4). That indexing is load-bearing for line detection (§13.1) and is not to be
 * changed for layout convenience.
 *
 * The line pips beneath are a fact, not a score — no count is rendered larger than
 * `label`, and nothing here orders Members against each other (§13.5).
 */

import { Platform, View } from 'react-native';
import { LINES } from '../src/domain/lines';
import { board as boardTokens, color, radius, space } from '../theme/tokens';
import { Tile, type TileGoal } from './Tile';

export interface BoardTile {
  id: string;
  position: number;
  goal: TileGoal | null;
  count: number;
}

interface Props {
  tiles: BoardTile[];
  centreMode: 'shared' | 'personal' | 'undecided';
  /** Indices into `LINES` that are complete. Empty until slice 13 records any. */
  completedLines?: readonly number[];
  onPressTile: (tile: BoardTile) => void;
}

export function Board({ tiles, centreMode, completedLines = [], onPressTile }: Props) {
  const gap = Platform.OS === 'ios' ? boardTokens.gap.ios : boardTokens.gap.android;
  const padding =
    Platform.OS === 'ios'
      ? boardTokens.paddingHorizontal.ios
      : boardTokens.paddingHorizontal.android;

  // Position order, always — the array's own order is not to be trusted, and a Board that
  // renders its squares in whatever order they arrived is a different board every launch.
  const byPosition = [...tiles].sort((a, b) => a.position - b.position);

  return (
    <View style={{ paddingHorizontal: padding }}>
      <View
        // No `grid` role: React Native's AccessibilityRole has no such value, and the
        // squares carry their own row/column in their labels anyway (§6).
        accessibilityLabel="Board, five by five"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}
      >
        {byPosition.map((tile) => (
          <View
            key={tile.id}
            // Five across with four gaps between them. Expressed as a percentage of the
            // row so the board fills whatever width it is given — 66.8pt at 402, 61.4pt
            // on an SE — without ever needing to scroll or shrink.
            style={{ width: `${(100 - 0.01) / boardTokens.columns}%`, maxWidth: undefined }}
          >
            <Tile
              position={tile.position}
              goal={tile.goal}
              count={tile.count}
              isCentre={tile.position === 12}
              centreMode={centreMode}
              onPress={() => onPressTile(tile)}
            />
          </View>
        ))}
      </View>

      {/* Twelve segments: 5 rows, 5 columns, 2 diagonals, in the constant order of §13.1.
          Enumerated, never computed — the order is part of the contract. */}
      <View
        accessible
        accessibilityLabel={`${completedLines.length} of ${LINES.length} lines`}
        style={{
          flexDirection: 'row',
          gap: space.xs,
          marginTop: space.md,
          justifyContent: 'center',
        }}
      >
        {LINES.map((_, i) => (
          <View
            key={i}
            style={{
              width: 14,
              height: 3,
              borderRadius: radius.pill,
              backgroundColor: completedLines.includes(i) ? color.moss : color.paperSunk,
            }}
          />
        ))}
      </View>
    </View>
  );
}
