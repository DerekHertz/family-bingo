/**
 * The 5x5 mark (FRONTEND_DESIGN §4, "Sign in").
 *
 * The product's own board, at rest. `paperSunk` tiles with a scatter of `mossTint` — the
 * quiet-until-it-grows principle (§0.2) stated before a Member has grown anything.
 *
 * The scatter is fixed, not random: a logo that reshuffles on every launch is not a logo.
 */

import { View } from 'react-native';
import { color, radius, space } from '../theme/tokens';

/** The board's real tile size at a 402pt handset (§3, `<Board>`). */
const BOARD_TILE = 66;

/**
 * Positions that carry the moss tint. Row-major, the same indexing the Board uses (§5.4).
 *
 * 12 is deliberately absent: the Centre is the Family's, and §3 gives it `clayTint`. Clay
 * means family and nothing else (§1.1), so the mark keeps that distinction rather than
 * flattening it into a decorative scatter.
 */
const TINTED = new Set([6, 8, 16, 18]);
const CENTRE = 12;

export function BoardMark({ tile = 18, gap = space.xs }: { tile?: number; gap?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Family Bingo"
      style={{ width: tile * 5 + gap * 4, flexDirection: 'row', flexWrap: 'wrap', gap }}
    >
      {Array.from({ length: 25 }, (_, i) => (
        <View
          key={i}
          style={{
            width: tile,
            height: tile,
            // The tile radius is specified against the board's own ~66pt tile, so it
            // scales with the mark rather than being reinvented at a fixed value.
            borderRadius: radius.tile * (tile / BOARD_TILE),
            backgroundColor:
              i === CENTRE ? color.clayTint : TINTED.has(i) ? color.mossTint : color.paperSunk,
          }}
        />
      ))}
    </View>
  );
}
