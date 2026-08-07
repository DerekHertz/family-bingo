/**
 * The board header's avatar strip (FRONTEND_DESIGN §4.5, PRD §23.3).
 *
 * > **The board header's avatar strip scrolls horizontally past 8.** Full-bleed (negative
 * > margin + matching padding so avatars pass under the screen edge), no scrollbar, snap
 * > off. It never truncates to "+12" — that counts people (§2 of the do-nots).
 *
 * Specified since the first design pass and unbuilt until §23, which is also when there
 * was finally somewhere for it to go: `boards_read` has always been Family-wide and the
 * Board route has always rendered a sibling's Board read-only, but nothing in the app
 * linked to one. This is the traverse — you are on a Board, and the Family is a swipe
 * away.
 *
 * **Faces and names, and nothing else** (§23.4). No ring, no count, no fraction. §7's
 * do-not #2 forbids ranking Members visually and names this component when it does it, and
 * a row of avatars each wearing a completion ring is an ordered comparison however it is
 * sorted — the reader does the sorting. Join order is what protects the sequence; keeping
 * the faces bare is what protects the content.
 *
 * No data fetching here: components in this codebase do none (`app/` composes, `components/`
 * renders).
 */

import { Pressable, ScrollView, Text, View } from 'react-native';
import type { StripFace } from '../src/domain/roster';
import { Avatar } from './Avatar';
import { styles } from '../theme/fonts';
import { color, radius, size, space, stroke } from '../theme/tokens';

interface Props {
  faces: readonly StripFace[];
  /**
   * The inset the surrounding screen uses, applied to the scroll *content* so the first
   * face lines up with the title above it.
   *
   * That is the whole of "full-bleed", and it is deliberately done this way round. The
   * obvious version is a negative `marginHorizontal` on a strip nested inside the padded
   * header — it looks identical on iOS and is broken on Android, where a touch is not
   * dispatched to a child lying outside its parent's bounds, so an avatar half-scrolled
   * under the leading edge would be visible and untappable. This component is a sibling of
   * the padded block instead, full width, insetting its own content.
   */
  gutter: number;
  onOpen: (boardId: string) => void;
  /**
   * Called when a finger lands on a face, before the tap has resolved into a press.
   *
   * Opening a Board is a round trip whatever we do; this spends the gesture's own duration
   * on it instead of waiting until it is over. Free in the sense that matters — it only
   * fires for a face somebody is already pressing, so nothing is fetched on spec.
   */
  onWarm?: (boardId: string) => void;
}

export function MemberStrip({ faces, gutter, onOpen, onWarm }: Props) {
  // One Member is not a Family to look across, and a strip of one is a decoration that
  // costs a row of height to say nothing.
  if (faces.length < 2) return null;

  return (
    <ScrollView
      horizontal
      // §4.5: no scrollbar, snap off. The default deceleration is the un-snapped one, so
      // this is a matter of not reaching for `snapToInterval` rather than of turning
      // anything off.
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: gutter,
        gap: space.md,
        alignItems: 'flex-start',
      }}
    >
      {faces.map((face) => {
        // The Board already on screen is not somewhere to go. It stays at full opacity and
        // keeps its ring — it is the cursor, not an unavailable face — but pressing it
        // fired `router.replace` at the identical route, and REPLACE mints a new route key,
        // so the screen tore down and remounted into "Loading the board" for a tap that
        // went nowhere.
        const openable = face.boardId !== null && !face.isCurrent;
        // Everyone appears, including whoever's Board has not sealed — §7's do-not #2
        // rejects "+12" because it counts people, and dropping the one Member without a
        // sealed Board removes them from a picture of their own Family, which is the same
        // thing done more thoroughly. They are dimmed and inert, not absent.
        return (
          <Pressable
            key={face.memberId}
            disabled={!openable}
            accessibilityRole={openable ? 'button' : 'image'}
            // The Pressable is the accessible element, so `<Avatar>`'s own label is
            // collapsed into this one on iOS — which is why the Managed dot has to be
            // said again here. A face that announced only a first initial would be a row
            // of unidentifiable buttons.
            accessibilityLabel={`${face.displayName}${
              face.isManaged ? ', a child in this Family' : ''
            }${face.isCurrent ? ', the board you are looking at' : ''}${
              face.boardId === null ? ', no board to open yet' : ''
            }`}
            accessibilityHint={openable && !face.isCurrent ? 'Opens their board' : undefined}
            accessibilityState={{ disabled: !openable, selected: face.isCurrent }}
            onPressIn={() => {
              if (openable && face.boardId !== null) onWarm?.(face.boardId);
            }}
            onPress={() => {
              if (face.boardId !== null) onOpen(face.boardId);
            }}
            style={({ pressed }) => ({
              alignItems: 'center',
              width: 56,
              minHeight: size.minTouch,
              // Dimmed only for a Member whose Board cannot be opened. The current face is
              // not openable either and must not be dimmed: it is the one you are reading.
              opacity: face.boardId === null ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            {/* The mark for "you are here" is a hairline ring in `ink3`, not `moss` and not
                `clay`: moss is the growth ladder and clay means family (§1.1), and spending
                either on a cursor would blunt the one place each of them means something. */}
            <View
              style={{
                padding: space.xs,
                borderRadius: radius.pill,
                borderWidth: face.isCurrent ? stroke.hairline : 0,
                borderColor: color.ink3,
              }}
            >
              <Avatar name={face.displayName} managed={face.isManaged} size={40} />
            </View>
            {/* The name, because a column of single initials is not identification — and
                §4.5's own objection to "+12" is that people should be named rather than
                counted. One line, ellipsised: the strip scrolls, the name does not. */}
            <Text
              numberOfLines={1}
              style={{
                ...styles.meta,
                color: face.isCurrent ? color.ink : color.ink2,
                marginTop: space.xs,
                maxWidth: 56,
                textAlign: 'center',
              }}
            >
              {face.displayName}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
