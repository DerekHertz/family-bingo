/**
 * The 12-segment line row beneath a Board (FRONTEND_DESIGN §3 `<Board>`).
 *
 * Five rows, five columns, two diagonals, in the constant order of §13.1 — enumerated from
 * `LINES` rather than computed, because `milestones.line_index` refers to that order and a
 * pip strip in a different one would name the wrong line.
 *
 * **A fact, not a score.** No count is rendered larger than `label`, nothing here orders
 * Members against each other, and there is deliberately no "3 of 12" in view (§13.5). The
 * whole count lives in the accessibility label, where it is read once instead of twelve
 * times.
 *
 * Its own component because the row is the compact form of "how far along is this board",
 * and anywhere that fact is shown twice it should be shown the same way. The Family screen
 * is the obvious second home — one strip per Member — and is deliberately not built yet:
 * it needs a Tile-count read for every Board in the Family rather than the caller's own,
 * and §13's acceptance test asks for the strip on the Board, which is where it is.
 */

import { View } from 'react-native';
import { LINES } from '../src/domain/lines';
import { color, radius, space } from '../theme/tokens';

interface Props {
  /** Indices into `LINES` that are complete. Empty until slice 13 records any. */
  completedLines: readonly number[];
}

export function LinePips({ completedLines }: Props) {
  return (
    <View
      accessible
      accessibilityLabel={`${completedLines.length} of ${LINES.length} lines`}
      // No margin of its own: a component that reserves space around itself cannot be
      // placed twice. The caller owns the gap.
      style={{ flexDirection: 'row', gap: space.xs, justifyContent: 'center' }}
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
  );
}
