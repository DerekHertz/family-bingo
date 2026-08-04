/**
 * The Board — 25 Tiles, 5 across (FRONTEND_DESIGN §3 `<Board>`).
 *
 * **Never scrolls, never shrinks, never paginates.** If the content below it does not
 * fit, that content scrolls *under* a pinned board — not the other way round. The whole
 * point of a bingo board is seeing all of it at once.
 *
 * Positions are row-major and 0-indexed: position `p` is row `p / 5`, column `p % 5`
 * (§5.4). That indexing is load-bearing for line detection (§13.1) and is not to be
 * changed for layout convenience — which is why the rows come from `rowsOf()` in the
 * domain, where the same arithmetic is already tested, rather than from a `flexWrap` that
 * happens to break in fives.
 *
 * **Five explicit rows, not one wrapping strip.** The wrapping version cannot be made
 * exact: React Native has no `calc()`, so five children can only be sized as a percentage
 * of the row, and five at `20%` plus four 7pt gaps is wider than 100% — the fifth square
 * wraps and the Board silently renders 4 across. Rows of `flex: 1` children need no
 * percentage at all: 402 − 40 padding − 28 gaps = 334, over five, is §3's 66.8pt exactly,
 * and 61.4pt at the 375pt SE floor.
 */

import { Platform, View } from 'react-native';
import { CENTER_POSITION, rowsOf } from '../src/domain/lines';
import { board as boardTokens, space } from '../theme/tokens';
import { LinePips } from './LinePips';
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

  // By position, always — the array's own order is not to be trusted, and a Board that
  // renders its squares in whatever order they arrived is a different board every launch.
  const rows = rowsOf(tiles);

  return (
    <View style={{ paddingHorizontal: padding }}>
      <View
        // No `grid` role: React Native's AccessibilityRole has no such value, and the
        // squares carry their own row/column in their labels anyway (§6).
        accessibilityLabel="Board, five by five"
        style={{ gap }}
      >
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: 'row', gap }}>
            {row.map((tile, columnIndex) =>
              tile === null ? (
                // A hole keeps the row square so every later column stays in its own
                // column. It should never happen — `open_year()` deals all 25 — but a
                // Board that renders four squares in the wrong places is worse than one
                // that renders a gap where a square is missing.
                <View key={`hole-${columnIndex}`} style={{ flex: 1, aspectRatio: 1 }} />
              ) : (
                <View key={tile.id} style={{ flex: 1 }}>
                  <Tile
                    position={tile.position}
                    goal={tile.goal}
                    count={tile.count}
                    isCentre={tile.position === CENTER_POSITION}
                    centreMode={centreMode}
                    onPress={() => onPressTile(tile)}
                  />
                </View>
              ),
            )}
          </View>
        ))}
      </View>

      <View style={{ marginTop: space.md }}>
        <LinePips completedLines={completedLines} />
      </View>
    </View>
  );
}
