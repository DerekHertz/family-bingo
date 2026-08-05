/**
 * The 5x5 mark (FRONTEND_DESIGN §4 "Sign in", §4.3).
 *
 * The product's own board, at rest. `paperSunk` tiles with a scatter of `mossTint` — the
 * quiet-until-it-grows principle (§0.2) stated before a Member has grown anything.
 *
 * The scatter is fixed, not random: a logo that reshuffles on every launch is not a logo.
 *
 * `tone` is the second thing this draws, and it was a second component: `CentreGlyph` in
 * `app/year/centre.tsx` was these twenty-five views again with a clay palette and its own
 * hand-written sizes. Two copies of a 5×5 is one copy that can stop being 5 across — and
 * that is not hypothetical, it is what the duplicate did. It declared `width: 46` for five
 * 8pt squares with 2pt gaps, which needs 48, so the fifth wrapped and the glyph rendered
 * **4 across in seven rows** with its "centre" nowhere near the middle. This file's width
 * is `tile * 5 + gap * 4`, which cannot be wrong, and it is the same trap the Board itself
 * hit (see `rowsOf` in src/domain/lines.ts).
 */

import { View } from 'react-native';
import { CENTER_POSITION } from '../src/domain/lines';
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

export function BoardMark({
  tile = 18,
  gap = space.xs,
  tone = 'rest',
}: {
  tile?: number;
  gap?: number;
  /**
   * `rest` is the wordmark's board: `paperSunk` with the fixed moss scatter and a
   * `clayTint` centre.
   *
   * `centre` is §4.3's explainer glyph — "a 5×5 with only the middle square filled" —
   * so it fills position 12 in `clay` on `clayTint` and nothing else, because that block
   * is about the one square the Family decides together.
   */
  tone?: 'rest' | 'centre';
}) {
  const centre = tone === 'centre';
  return (
    <View
      // The mark IS the product's name on the sign-in screen, so it says so. The centre
      // glyph is not: it sits inside a `clayTint` block whose own sentence already explains
      // the middle square, and a second voice describing the picture beside it would say
      // the same thing twice (§6).
      {...(centre
        ? {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          }
        : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: 'Family Bingo' })}
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
            backgroundColor: centre
              ? i === CENTER_POSITION
                ? color.clay
                : color.clayTint
              : i === CENTER_POSITION
                ? color.clayTint
                : TINTED.has(i)
                  ? color.mossTint
                  : color.paperSunk,
          }}
        />
      ))}
    </View>
  );
}
