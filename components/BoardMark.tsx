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

/** Positions that carry the tint. Row-major, the same indexing the Board uses (§5.4). */
const TINTED = new Set([6, 8, 12, 16, 18]);

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
            borderRadius: radius.tile * (tile / 66),
            backgroundColor: TINTED.has(i) ? color.mossTint : color.paperSunk,
          }}
        />
      ))}
    </View>
  );
}
