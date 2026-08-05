/**
 * One card of Wrapped (FRONTEND_DESIGN §3 `<WrappedCard>`, PRD §20.4–§20.9).
 *
 * Full-bleed, one per screen, and no chrome except the 6-segment rail at the top. Every
 * word on it was decided in `src/domain/wrapped.ts`, which is where the copy voice ("warm,
 * brief, occasionally funny, never coachy") is enforced once instead of in fifteen branches
 * of the JSX below. Nothing here computes a statistic and nothing here sorts a Member.
 *
 * **Two grounds, and no third.** Personal cards are `mossDeep` with `paper` text; Family,
 * Awards and Final are `paper` with `ink`. **Wrapped has no dark mode** (§1.2, §7.12) — its
 * cards already are their own grounds, so nothing on this screen consults the colour
 * scheme, and `theme/tokens.ts`'s `dark` export is deliberately not imported.
 *
 * **No new colour** (§7.1). `sun` belongs to the sunflower, clay means family and appears
 * only on the Family Goal block, and there is no gold for an Award. The category breakdown
 * is the one place `categoryTint` is allowed, and §20.5 is what allows it.
 *
 * Two accessibility decisions worth stating, both from traps this repo has already paid for:
 *
 *   - The card itself is never `accessible`. An `accessible` container collapses its whole
 *     subtree on iOS, which would take the Share button and the "Open next year" button
 *     with it. The *content block* carries the one sensible reading of §6 and the buttons
 *     are siblings of it — the same shape `app/year/centre.tsx` settled on.
 *   - The rail is one element, not six. Six identical bars announced one at a time is six
 *     interruptions for a fact that fits in four words.
 */

import { memo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { StatCell, WrappedCardModel } from '../src/domain/wrapped';
import { styles } from '../theme/fonts';
import { categoryTint, color, radius, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';

interface Props {
  card: WrappedCardModel;
  /** Zero-based, for the rail. */
  index: number;
  /** How many cards the deck has — six in the ordinary case (§3). */
  total: number;
  /** The card is exactly one screen wide; the pager owns the measurement. */
  width: number;
  /** §20.9 — hands over the Member's own stats, and nothing else exists to hand over. */
  onShare?: (() => void) | undefined;
  /** §20.6 — only ever passed when `open_year()` would actually accept the call. */
  onOpenNextYear?: (() => void) | undefined;
  opening?: boolean;
}

/** How much of a 118pt numeral Dynamic Type is allowed to add. See the note at `Numeral`. */
const NUMERAL_MAX_SCALE = 1.3;

/**
 * The 6-segment progress rail (§3): `paper` on the dark card, `ink` on the light one.
 *
 * One accessible element carrying "Card 3 of 6". The bars are hidden from the screen reader
 * individually — a container `accessible` already collapses them on iOS, and
 * `no-hide-descendants` is what does the same on Android.
 */
function Rail({ index, total, tone }: { index: number; total: number; tone: string }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Card ${index + 1} of ${total}`}
      style={{
        flexDirection: 'row',
        gap: space.xs,
        paddingHorizontal: space.xl,
        paddingTop: space.xxl,
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            flex: 1,
            height: 3,
            borderRadius: radius.pill,
            backgroundColor: tone,
            // No second colour for the segments that are not this one: the palette has no
            // state colours, so "behind" and "ahead" are the same bar at less weight (§1.1).
            opacity: i === index ? 1 : 0.3,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The one big number (§3): Shippori at 118pt on a .9 line height.
 *
 * `maxFontSizeMultiplier` is the §6 A4 compromise, and the only capped text on the card.
 * A4 asks for Dynamic Type to XXL everywhere but the board, and at XXL a 118pt numeral is
 * roughly 280pt — wider than any handset, so it would be clipped rather than large. It is
 * capped at 1.3 and everything else on the card runs to the full range; the card also
 * scrolls, so nothing is ever cut off whichever way the setting lands.
 */
function Numeral({ value, caption }: { value: string; caption: string }) {
  return (
    <View>
      <Text
        maxFontSizeMultiplier={NUMERAL_MAX_SCALE}
        style={{ ...styles.wrappedNumeral, color: color.paper }}
      >
        {value}
      </Text>
      <Text style={{ ...styles.body, color: color.mossTint, marginTop: space.sm }}>
        {caption}
      </Text>
    </View>
  );
}

/**
 * The 2×2 hairline grid of supporting stats (§3).
 *
 * Two rows of two rather than one wrapping strip, for the reason the Board learned the hard
 * way: React Native has no `calc()`, so percentage children plus a gap overflow their row
 * and the last one wraps. Two `flex: 1` children per row cannot.
 */
function StatGrid({ cells }: { cells: readonly StatCell[] }) {
  return (
    <View style={{ marginTop: space.xl, borderTopWidth: 1, borderTopColor: color.hairline }}>
      {[0, 1].map((row) => (
        <View
          key={row}
          style={{
            flexDirection: 'row',
            borderBottomWidth: 1,
            borderBottomColor: color.hairline,
          }}
        >
          {[0, 1].map((column) => {
            const cell = cells[row * 2 + column];
            if (cell === undefined) return null;
            return (
              <View
                key={column}
                style={{
                  flex: 1,
                  paddingVertical: space.md,
                  paddingHorizontal: column === 0 ? 0 : space.md,
                  borderLeftWidth: column === 0 ? 0 : 1,
                  borderLeftColor: color.hairline,
                }}
              >
                <Text style={{ ...styles.heading, color: color.paper }}>{cell.value}</Text>
                <Text style={{ ...styles.label, color: color.mossTint, marginTop: space.xs }}>
                  {cell.caption}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** The 25 empty squares of the final card (§20.6). Views and border-radius only (§7.5). */
function EmptyBoard() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ gap: space.sm, marginTop: space.xl }}
    >
      {Array.from({ length: 5 }, (_, row) => (
        <View key={row} style={{ flexDirection: 'row', gap: space.sm }}>
          {Array.from({ length: 5 }, (_, column) => (
            <View
              key={column}
              style={{
                flex: 1,
                aspectRatio: 1,
                borderRadius: radius.tile,
                backgroundColor: color.paperSunk,
                borderWidth: 1,
                // Dashed, exactly as an unwritten Tile on a sealed Board is (§10.2, §3) —
                // these are squares nobody has written yet, not squares that went wrong.
                borderStyle: 'dashed',
                borderColor: color.hairline,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export const WrappedCard = memo(function WrappedCard({
  card,
  index,
  total,
  width,
  onShare,
  onOpenNextYear,
  opening = false,
}: Props) {
  const moss = card.ground === 'moss';
  const ground = moss ? color.mossDeep : color.paper;
  const ink = moss ? color.paper : color.ink;
  const ink2 = moss ? color.mossTint : color.ink2;

  return (
    <View style={{ width, flex: 1, backgroundColor: ground }}>
      <Rail index={index} total={total} tone={ink} />

      {/*
        Every card scrolls, and none of them looks like it does. §6 A4 runs Dynamic Type to
        XXL and a fixed-height card at XXL clips its own bottom — which on the Awards card
        would mean a Member's name simply not being on screen, the one failure §20.7 exists
        to prevent. `flexGrow: 1` with centred content keeps a short card centred and lets a
        long one (the Milestone timeline is the whole Family's year) run.
      */}
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: space.xl,
          // Room for the pager's one piece of chrome. `app/year/wrapped.tsx` pins a "Done"
          // over the bottom-left corner — a horizontal pager eats iOS's swipe-back gesture
          // and this app shows no header, so without it there is no way out of Wrapped —
          // and a card that ended flush would put its last line underneath it.
          paddingBottom: space.xxl * 2,
        }}
      >
        {card.kind === 'personal' ? (
          <>
            {/* One element, one reading (§6). The Share button is a sibling, because an
                `accessible` container swallows its whole subtree on iOS. */}
            <View accessible accessibilityLabel={card.reading}>
              <Text style={{ ...styles.meta, color: ink2 }}>{card.title}</Text>
              <View style={{ marginTop: space.lg }}>
                <Numeral value={card.numeral} caption={card.numeralCaption} />
              </View>
              <StatGrid cells={card.cells} />
              {card.footnote === null ? null : (
                <Text style={{ ...styles.body, color: ink2, marginTop: space.md }}>
                  {card.footnote}
                </Text>
              )}
            </View>

            {/* §20.9 — the Member's own card, stats only. The full Family Wrapped is
                in-app only: a screenshot is always the Member's call, but a one-tap button
                that publishes a child's name would be the app's (ADR-0006, ADR-0005). */}
            {onShare === undefined ? null : (
              <Button
                label="Share your numbers"
                variant="outlined"
                accessibilityHint="Shares your own tiles, lines and increments. No names, no photos, nobody else."
                style={{ marginTop: space.xl, alignSelf: 'flex-start', paddingHorizontal: space.lg }}
                onPress={onShare}
              />
            )}
          </>
        ) : null}

        {card.kind === 'family-totals' ? (
          <View accessible accessibilityLabel={card.reading}>
            <Text accessibilityRole="header" style={{ ...styles.title, color: ink }}>
              {card.title}
            </Text>
            <Text style={{ ...styles.cardHead, color: ink, marginTop: space.lg }}>
              {card.headline}
            </Text>

            {/* "Together you read 47 books and walked 2,100 times" (§20.5), grouped on the
                canonical Unit so one Member's "Books" and another's "book" add up. */}
            {card.units.length === 0 ? null : (
              <View style={{ marginTop: space.lg, gap: space.xs }}>
                {card.units.map((line) => (
                  <Text key={line} style={{ ...styles.body, color: ink }}>
                    {line}
                  </Text>
                ))}
                {card.unitsCaveat === null ? null : (
                  <Text style={{ ...styles.label, color: ink2, marginTop: space.xs }}>
                    {card.unitsCaveat}
                  </Text>
                )}
              </View>
            )}

            {/* The one place `categoryTint` is allowed to exist (§1, §20.5). Never on a
                tile, never in the Feed, and never an eighth hue. */}
            {card.categories.length === 0 ? null : (
              <View style={{ marginTop: space.xl, gap: space.sm }}>
                {card.categories.map((slice) => (
                  <View
                    key={slice.category}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
                  >
                    <View
                      style={{
                        flex: 1,
                        height: 10,
                        borderRadius: radius.pill,
                        backgroundColor: color.paperSunk,
                        overflow: 'hidden',
                      }}
                    >
                      <View
                        style={{
                          width: `${slice.share}%`,
                          height: '100%',
                          borderRadius: radius.pill,
                          backgroundColor:
                            categoryTint[slice.category as keyof typeof categoryTint] ??
                            categoryTint.other,
                        }}
                      />
                    </View>
                    <Text style={{ ...styles.label, color: ink, width: 140 }}>{slice.text}</Text>
                  </View>
                ))}
              </View>
            )}

            {card.busiestMonth === null ? null : (
              <Text style={{ ...styles.body, color: ink2, marginTop: space.xl }}>
                {card.busiestMonth} was the month you were all busiest.
              </Text>
            )}
          </View>
        ) : null}

        {card.kind === 'family-story' ? (
          <>
            <View accessible accessibilityLabel={card.reading}>
              <Text accessibilityRole="header" style={{ ...styles.title, color: ink }}>
                {card.title}
              </Text>

              {/* Clay means family, and nothing else may use it (§1.1). §3 puts the Family
                  Goal outcome in a `clayTint` block; this is that block. */}
              <View
                style={{
                  marginTop: space.lg,
                  padding: space.lg,
                  borderRadius: radius.card,
                  backgroundColor: color.clayTint,
                }}
              >
                <Text style={{ ...styles.cardHead, color: color.ink }}>{card.centre.heading}</Text>
                <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
                  {card.centre.body}
                </Text>
              </View>
            </View>

            {/* Every Milestone of the Year, in order, whole. Trimming it would mean choosing
                which ones matter, and the last time this list was narrowed — to Bingo and
                Blackout — it became a chronological ranking of who got there first
                (migration ..._029 §6). Each row is its own reading; the block above says how
                many there are so a screen reader knows what it is about to hear. */}
            {card.timeline.length === 0 ? (
              <Text style={{ ...styles.body, color: ink2, marginTop: space.xl }}>
                Nothing was recorded this year. It still counted as a year.
              </Text>
            ) : (
              <View style={{ marginTop: space.xl }}>
                {card.timeline.map((entry) => (
                  <Text
                    key={entry.id}
                    style={{
                      ...styles.label,
                      color: ink,
                      paddingVertical: space.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: color.hairline,
                    }}
                  >
                    {entry.text}
                  </Text>
                ))}
              </View>
            )}
          </>
        ) : null}

        {card.kind === 'awards' ? (
          <>
            <View accessible accessibilityLabel={card.reading}>
              <Text accessibilityRole="header" style={{ ...styles.title, color: ink }}>
                {card.title}
              </Text>
              <Text style={{ ...styles.body, color: ink2, marginTop: space.sm }}>
                {card.blurb}
              </Text>
            </View>

            {/* A flat list: avatar, award name in `cardHead`, one line of `ink2` (§3).
                **No ordering, no numbering, no "1st"** — the rows arrive in the Family's
                join order and nothing here re-sorts them. Every Member appears at least
                once; `showed_up` is the server's floor and guarantees it (§20.7). */}
            <View style={{ marginTop: space.xl, gap: space.lg }}>
              {card.rows.map((row) => (
                <View
                  key={row.id}
                  accessible
                  accessibilityLabel={`${row.memberName}${
                    row.isManaged ? ', a child in this Family' : ''
                  }. ${row.label}. ${row.explanation}`}
                  style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}
                >
                  {/* Said once, on the row, rather than twice — the Avatar carries its own
                      label and the row has already spoken the name and the clay dot. */}
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Avatar name={row.memberName} managed={row.isManaged} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...styles.cardHead, color: ink }}>{row.label}</Text>
                    <Text style={{ ...styles.body, color: ink2, marginTop: space.xs }}>
                      {row.explanation}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {card.kind === 'final' ? (
          <>
            <View accessible accessibilityLabel={card.reading}>
              <Text accessibilityRole="header" style={{ ...styles.display, color: ink }}>
                {card.title}
              </Text>
              <Text style={{ ...styles.body, color: ink2, marginTop: space.md }}>
                {card.body}
              </Text>
            </View>

            <EmptyBoard />

            {/* §20.6 — a `moss` button straight into opening the next Year. Rendered only
                when `open_year()` would accept it: it refuses a non-Organizer with 42501 and
                a Year the Family already has with PT409, and a button the server will refuse
                is a shape this repo has already shipped once. */}
            {onOpenNextYear === undefined || card.action === null ? null : (
              <Button
                label={opening ? 'Opening…' : card.action.label}
                variant="primary"
                disabled={opening}
                style={{ marginTop: space.xl }}
                onPress={onOpenNextYear}
              />
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
});
