/**
 * One row of the Feed (FRONTEND_DESIGN §3 `<FeedRow>`).
 *
 * > One row per event, reverse chronological, `hairline` divider between. 34pt leading
 * > slot.
 *
 * The leading slot is the whole visual language of the list: an avatar means a person did
 * something, a moss square means a Tile closed, a clay seal means the Family should look
 * up. A Member scrolling recognises the shape before reading the sentence, which is the
 * point of giving five event kinds five glyphs instead of five headings.
 *
 * **`tile_completed` is the only tinted row**, and §3 says so explicitly. If a second row
 * type ever gets a background the tint stops meaning "a goal closed" and the Feed becomes
 * a wall of colour — which is the same argument §4.1 makes about the drafting table's pips
 * never being `moss`.
 *
 * The sentences are not here. They are `src/domain/feed.ts`, where they can be tested
 * without a renderer, and where §7's rules about ranking and attribution are enforced once
 * rather than in five branches of JSX.
 */

import { memo } from 'react';
import { Text, View } from 'react-native';
import { feedCopy, feedLabel, toneOf, type FeedEvent } from '../src/domain/feed';
import { shortDate } from '../src/domain/when';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Sunflower } from './Sunflower';

/** §3's "34pt leading slot". */
const SLOT = 34;

interface Props {
  event: FeedEvent;
  /** The Member's name, or the honest fallback when they are no longer on the roster. */
  name: string;
  /** §4.7's clay dot, everywhere they appear. */
  managed: boolean;
  lineNameOf: (lineIndex: number) => string;
}

export const FeedRow = memo(function FeedRow({ event, name, managed, lineNameOf }: Props) {
  const tone = toneOf(event);
  const copy = feedCopy(event, () => name, lineNameOf);
  const when = shortDate(event.createdAt);

  return (
    <View
      // One focusable element carrying one sentence. A row split into avatar, headline,
      // detail and timestamp is four swipes to learn one thing, and a Feed is read by
      // scrolling past it rather than by inspecting each row.
      accessible
      accessibilityLabel={feedLabel(event, copy, when, managed)}
      style={{
        flexDirection: 'row',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.xl,
        alignItems: 'flex-start',
        // §3: "`hairline` divider **between**" — so the divider is the row's bottom edge,
        // not its top. As a top border the first row draws a rule directly under the
        // header where §3 asks for none, and the tinted row below gets a doubled 2pt rule:
        // its own `mossTintEdge` bottom plus the next row's `hairline` top, stacked. The
        // one row type §3 singles out for clean edges owns both of its own.
        borderBottomWidth: 1,
        borderBottomColor: color.hairline,
        // §3's backgrounds. An Increment and a seal both sit on `paperRaised`; only the
        // tinted row departs from it, and it is the only one that may.
        backgroundColor:
          tone === 'complete'
            ? color.mossTint
            : tone === 'quiet'
              ? color.paper
              : color.paperRaised,
        ...(tone === 'complete'
          ? {
              borderTopWidth: 1,
              borderTopColor: color.mossTintEdge,
              borderBottomColor: color.mossTintEdge,
            }
          : null),
        // §3's 75% for a Member arriving is carried by the empty avatar's own `pending`
        // dimming (see `Leading`), so the row does not apply it again — two 75%s compound
        // to 56% and the row all but disappears.
      }}
    >
      <View style={{ width: SLOT, alignItems: 'center' }}>
        <Leading tone={tone} name={name} managed={managed} kind={event.kind} />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            // §3: a Bingo or a Blackout is a headline in Shippori. Nothing else in the
            // Feed is — a display face on every row would flatten the difference between
            // "walked one" and "finished the board".
            ...(tone === 'seal' ? styles.cardHead : styles.body),
            color: color.ink,
          }}
        >
          {copy.headline}
        </Text>

        {/* A Swap shows both sides, because §4.4 says the record is never rewritten: the
            retired Goal keeps its Increments and still counts. Struck through in `ink3`
            and not in any colour, because there is no red and a Swap is not a failure. */}
        {event.kind === 'swap' && event.beforeText !== null ? (
          <Text style={{ ...styles.body, color: color.ink3, marginTop: space.xs, textDecorationLine: 'line-through' }}>
            {event.beforeText}
          </Text>
        ) : null}

        {copy.detail === null ? null : (
          <Text
            style={{
              ...styles.body,
              // The new Goal after a Swap is the one that counts from here, so it is `ink`
              // at 700 against the struck-through `ink3` above it (§3).
              ...(event.kind === 'swap' ? { fontWeight: '700' as const } : null),
              color: event.kind === 'swap' ? color.ink : color.ink2,
              marginTop: space.xs,
            }}
          >
            {copy.detail}
          </Text>
        )}

        {/* §11.1 — a note is optional, always. When there is one it is the Member's own
            words and gets `body` weight, not `meta`. */}
        {event.note === null || event.note.trim() === '' ? null : (
          <Text style={{ ...styles.body, color: color.ink, marginTop: space.sm }}>
            {event.note}
          </Text>
        )}

        {/* §16's Attachment renders here as a 150pt image from a signed URL. Until slice 16
            mints one, saying a photo exists is more honest than a broken frame — and §3's
            placeholder rule (never a spinner, never a blur-up of a cached child's face)
            is about loading, not about a feature that is not built. */}
        {event.attachmentPath === null ? null : (
          <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.sm }}>
            With a photo
          </Text>
        )}

        <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xs }}>{when}</Text>
      </View>
    </View>
  );
});

/**
 * The 34pt leading slot (§3's table).
 *
 * Decorative in every branch: the row above carries the whole sentence, so a glyph that
 * announced itself would say the Member's name twice.
 */
function Leading({
  tone,
  name,
  managed,
  kind,
}: {
  tone: ReturnType<typeof toneOf>;
  name: string;
  managed: boolean;
  kind: FeedEvent['kind'];
}) {
  if (tone === 'complete') {
    // §3: a `moss` rounded square with a 20pt paper sunflower — the same mark a completed
    // Tile carries, at Feed scale, so the row and the board say the same thing.
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: SLOT,
          height: SLOT,
          borderRadius: radius.tile,
          backgroundColor: color.moss,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Sunflower size={20} petalColor={color.paper} petalSpread={32} />
      </View>
    );
  }

  if (tone === 'seal') {
    // §3: a clay seal — a 2px inset frame with a clay leaf inside it. Clay because a Bingo
    // is the moment the Family looks up, and clay means family (§1.1).
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: SLOT,
          height: SLOT,
          borderRadius: radius.tile,
          borderWidth: 2,
          borderColor: color.clay,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 12,
            height: 12,
            backgroundColor: color.clay,
            // The leaf glyph of §2: one rounded corner pair, rotated. No SVG, no asset.
            borderTopLeftRadius: 12,
            borderBottomRightRadius: 12,
            transform: [{ rotate: '-15deg' }],
          }}
        />
      </View>
    );
  }

  if (kind === 'swap') {
    // §3: a `paperSunk` square with a minus bar. Not a delete glyph — nothing was deleted
    // (§7.10), and the bar is the only mark in the app that means "one fewer".
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: SLOT,
          height: SLOT,
          borderRadius: radius.tile,
          backgroundColor: color.paperSunk,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 14, height: 2, backgroundColor: color.ink3, borderRadius: radius.pill }} />
      </View>
    );
  }

  if (kind === 'vote_resolved') {
    // The Centre's own glyph: a clay dot, the same mark the shared Centre Tile carries
    // top-centre (§3 `<Tile>`). A Family decision has no author, so it gets no avatar.
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: SLOT,
          height: SLOT,
          borderRadius: radius.tile,
          backgroundColor: color.clayTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: size.dot,
            height: size.dot,
            borderRadius: radius.pill,
            backgroundColor: color.clay,
          }}
        />
      </View>
    );
  }

  // An Increment, or a Member arriving — which §3 renders as an *empty* circle, because
  // there is nothing they have done yet.
  //
  // `pending` is what draws that circle: a transparent ground with a hairline ring and no
  // glyph. Passing an empty `name` alone does not, because `<Avatar>` falls back to '?' —
  // so the row welcoming somebody rendered the one mark in the app that reads as "unknown
  // person". `pending` also dims to 75%, which the row is already doing, so the row's own
  // opacity comes off rather than compounding to 56%.
  const joining = kind === 'member_joined';
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Avatar
        name={joining ? '' : name}
        pending={joining}
        size={SLOT}
        managed={managed}
      />
    </View>
  );
}
