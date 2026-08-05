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

import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useReduceMotion } from '../lib/reduce-motion';
import { CENTER_POSITION, rowsOf } from '../src/domain/lines';
import { board as boardTokens, space } from '../theme/tokens';
import { LineDraw } from './LineDraw';
import { LinePips } from './LinePips';
import { Tile, type TileGoal } from './Tile';

export interface BoardTile {
  id: string;
  position: number;
  goal: TileGoal | null;
  count: number;
}

/** A Line that just closed, and should be drawn through once (§5). */
export interface LineCelebration {
  lineIndex: number;
  /**
   * The Milestone's id. Restarting an `Animated` sequence needs a value that changes, and
   * the line index alone does not — the same Line closing on a second Board would replay
   * nothing.
   */
  key: string;
}

interface Props {
  tiles: BoardTile[];
  centreMode: 'shared' | 'personal' | 'undecided';
  /** Indices into `LINES` that are complete, derived on read and never stored (§13.1). */
  completedLines?: readonly number[];
  /**
   * §5's Line animation, or `null` for the resting board.
   *
   * Separate from `completedLines` because the two answer different questions and are
   * allowed to disagree: the pips say which Lines *stand right now*, derived live from the
   * counts, while this says which Line was just *earned*. Deleting an Increment un-closes
   * a Line and empties a pip, but the `bingo` Milestone stays — it was pushed and cannot
   * be unsent (§15.3).
   */
  celebrate?: LineCelebration | null;
  /** Called when the drawing has finished, so the caller can clear `celebrate`. */
  onCelebrationDone?: () => void;
  /**
   * Opens the tile sheet. **Omit it when there is no sheet to open** — the squares then
   * render inert instead of announcing themselves as 25 buttons that do nothing, which is
   * what §6 A1 costs when a screen reader is invited to tap something with no action
   * behind it. One-tap logging is never wired here (§3, §11.1).
   */
  onPressTile?: (tile: BoardTile) => void;
}

export function Board({
  tiles,
  centreMode,
  completedLines = [],
  celebrate = null,
  onCelebrationDone,
  onPressTile,
}: Props) {
  const gap = Platform.OS === 'ios' ? boardTokens.gap.ios : boardTokens.gap.android;
  const padding =
    Platform.OS === 'ios'
      ? boardTokens.paddingHorizontal.ios
      : boardTokens.paddingHorizontal.android;
  const reduceMotion = useReduceMotion();

  // The grid's own width, measured. The squares are `flex: 1` and have no size until the
  // layout pass runs (§3 puts them at 66.8pt on a 402pt screen and 61.4pt on the 375pt
  // floor), and the Line overlay has to land on top of them to the pixel.
  const [gridWidth, setGridWidth] = useState(0);

  // By position, always — the array's own order is not to be trusted, and a Board that
  // renders its squares in whatever order they arrived is a different board every launch.
  const rows = rowsOf(tiles);

  return (
    <View style={{ paddingHorizontal: padding }}>
      <View
        onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
        // Deliberately unlabelled. React Native's AccessibilityRole has no `grid`, and a
        // label here would need `accessible` to be announced at all — which on iOS
        // collapses the subtree into one element and takes all 25 Tile labels with it.
        // The squares carry their own row and column instead (§6 A1), which is the
        // navigation a swipe actually needs.
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
                    onPress={
                      onPressTile === undefined ? undefined : () => onPressTile(tile)
                    }
                  />
                </View>
              ),
            )}
          </View>
        ))}

        {/* Over the squares, never between them: the overlay is a sibling of the rows
            inside the same measured box, so its coordinates and theirs are the same. */}
        {celebrate === null ? null : (
          <LineDraw
            lineIndex={celebrate.lineIndex}
            width={gridWidth}
            gap={gap}
            runKey={celebrate.key}
            reduceMotion={reduceMotion}
            onDone={onCelebrationDone}
          />
        )}
      </View>

      <View style={{ marginTop: space.md }}>
        <LinePips completedLines={completedLines} />
      </View>
    </View>
  );
}
