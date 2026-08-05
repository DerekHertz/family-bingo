/**
 * The Swap confirm sheet (FRONTEND_DESIGN §4.4, PRD §18).
 *
 * > **Confirm sheet** — `meta` position line, `title` "Swap this goal?", the outgoing Goal
 * > in a hairline card with its live tile glyph and `count of target`, one paragraph of
 * > plain copy about what happens to the logged Increments, a 3-pip budget row on
 * > `paperSunk`, then the confirm: **`clayDeep` text on `paper` inside a hairline border**
 * > (§1.1 — this is the destructive-confirm treatment, and it is the only place in the app
 * > that uses it). "Keep it" is a 52pt text row below.
 *
 * Three of those five elements exist to answer a question the Member is about to ask, and
 * the sheet is worth its own screen only because of them:
 *
 *   - **The glyph and the count**, because "swap this one" means nothing without seeing how
 *     far along it already is. §4.4 permits swapping a Tile at 97%, and a Member about to
 *     do that should be looking at the 97%.
 *   - **The paragraph**, because the honest answer is counter-intuitive: nothing is
 *     deleted. The retired Goal keeps its Increments and they still count for the year;
 *     the square resets because `COUNT(increments)` on the *new* Goal is zero, not because
 *     anything was thrown away (§4.4, §7.10).
 *   - **The pips**, because scarcity is the feature (§18.5). Three per Year is what stops
 *     a Member lowering a Target from 144 to 90 in November and manufacturing a Bingo, and
 *     a budget nobody can see is not a budget anybody feels.
 *
 * **There is no red here and there is none anywhere.** §1.1's destructive-confirm
 * treatment — `clayDeep` text on `paper` inside a `hairline` border — is the whole of it,
 * and this is the only screen in the app entitled to use it.
 *
 * Spent on write, not on open (§4.4). This sheet costs nothing; the budget moves when the
 * new Goal is saved, which is the trigger on `revisions` doing it server-side.
 */

import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { columnOf, rowOf } from '../src/domain/lines';
import { SWAP_BUDGET, swapsRemaining, swapConsequenceCopy } from '../src/domain/swaps';
import { progressOf, stageOf } from '../src/domain/growth';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';
import { TileGrowth } from './TileGrowth';

export interface SwapCandidate {
  tileId: string;
  position: number;
  /** `null` on an empty square that sealed unwritten — filling it costs a Swap (§18.5). */
  text: string | null;
  target: number;
  count: number;
}

interface Props {
  /** `null` closes the sheet. */
  tile: SwapCandidate | null;
  swapsUsed: number;
  onClose: () => void;
  /** Straight into compose. The budget moves when that screen saves, not here. */
  onConfirm: () => void;
}

export function SwapSheet({ tile, swapsUsed, onClose, onConfirm }: Props) {
  if (tile === null) return null;

  const remaining = swapsRemaining(swapsUsed);
  const where = `Row ${rowOf(tile.position) + 1}, column ${columnOf(tile.position) + 1}`;
  const progress = tile.text === null ? 0 : progressOf(tile.count, tile.target);
  const stage = tile.text === null ? 'dormant' : stageOf(tile.count, tile.target);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: color.scrim }}
      />

      <View
        style={{
          backgroundColor: color.paperRaised,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          paddingHorizontal: space.xl,
          paddingTop: space.xl,
          paddingBottom: space.xxl,
          maxHeight: '82%',
        }}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={{ ...styles.meta, color: color.ink3 }}>{where}</Text>
          <Text
            accessibilityRole="header"
            style={{ ...styles.title, color: color.ink, marginTop: space.xs }}
          >
            {tile.text === null ? 'Fill this square?' : 'Swap this goal?'}
          </Text>

          {/* The outgoing Goal, with its live glyph — §4.4 asks for both, and the glyph is
              the argument: a Member about to swap a Tile at 97% should be looking at it. */}
          <View
            accessible
            accessibilityLabel={
              tile.text === null
                ? 'This square is empty.'
                : `${tile.text}. ${tile.count} of ${tile.target}.`
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              marginTop: space.lg,
              padding: space.md,
              borderWidth: 1,
              borderColor: color.hairline,
              borderRadius: radius.card,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: radius.tile,
                overflow: 'hidden',
                backgroundColor: stage === 'complete' ? color.moss : color.paperSunk,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TileGrowth stage={stage} progress={progress} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...styles.body, color: color.ink }}>
                {tile.text ?? 'Nothing written here'}
              </Text>
              {tile.text === null ? null : (
                <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
                  {tile.count} of {tile.target}
                </Text>
              )}
            </View>
          </View>

          {/* The paragraph. The counter-intuitive part said plainly, because the obvious
              reading of "swap" is "delete", and it is wrong (§4.4, §7.10). */}
          <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>
            {swapConsequenceCopy(tile.text === null ? 0 : tile.count)}
          </Text>

          {/* §4.4's 3-pip budget row on `paperSunk`. Pips rather than "2 of 3" for the same
              reason §4.5 uses them for seats: three fit on one line and nobody should have
              to read a fraction to feel a limit. `ink3`, never `moss` — spending a swap is
              not growth (§4.1's rule about the drafting table's pips, same argument). */}
          <View
            accessible
            accessibilityLabel={
              remaining === 1 ? 'One swap left this year' : `${remaining} swaps left this year`
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              marginTop: space.lg,
              padding: space.md,
              backgroundColor: color.paperSunk,
              borderRadius: radius.card,
            }}
          >
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {Array.from({ length: SWAP_BUDGET }, (_, i) => (
                <View
                  key={i}
                  style={{
                    width: size.dot,
                    height: size.dot,
                    borderRadius: radius.pill,
                    backgroundColor: i < remaining ? color.ink3 : color.hairline,
                  }}
                />
              ))}
            </View>
            {/* No numeral. The comment above is the argument — "nobody should have to
                read a fraction to feel a limit" — and §4.4 asks for the pip row and
                nothing else. The count is in the row's accessibility label, where it is
                read once instead of sitting on the screen as a score. */}
            <Text style={{ ...styles.meta, color: color.ink2 }}>
              {remaining === 0 ? 'None left' : 'Swaps left'}
            </Text>
          </View>

          {/* §1.1's destructive-confirm treatment, and the only place in the app that uses
              it: `clayDeep` text on `paper` inside a `hairline` border. Not a filled
              button, and emphatically not red — there is no red in this palette, and a
              Member changing their mind about a goal in March has done nothing wrong. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              tile.text === null
                ? 'Write a goal here. It costs one of your swaps.'
                : remaining === 1
                  ? 'Swap this goal. It costs your last swap.'
                  : 'Swap this goal. It costs one of your swaps.'
            }
            onPress={onConfirm}
            style={({ pressed }) => ({
              marginTop: space.lg,
              height: size.controlPrimary,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: color.paper,
              borderWidth: 1,
              borderColor: color.hairline,
              borderRadius: radius.card,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...styles.action, color: color.clayDeep }}>
              {tile.text === null ? 'Write a goal here' : 'Swap it'}
            </Text>
          </Pressable>

          {/* §4.4: "'Keep it' is a 52pt text row below." The way out is always the larger
              target of the two in weight, if not in size — nothing here is a trap. */}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              height: size.control,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...styles.action, color: color.ink2 }}>
              {tile.text === null ? 'Not now' : 'Keep it'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
