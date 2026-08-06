/**
 * The app, kept phone-shaped on a screen that is not one.
 *
 * FRONTEND_DESIGN is a mobile spec and says so: §0 "Platform: Expo (iOS + Android)", and
 * §3 sizes the Board from the viewport with reference geometry at 402pt and a floor at
 * 375pt. `<Board>` lays out rows of `flex: 1`, so on a 1440px browser window those 66.8pt
 * tiles become 260pt tiles — a bingo board the size of a dinner plate, with a 16pt goal
 * label lost in the middle of each square. Nothing breaks; it just looks like nobody tried.
 *
 * So on web the app renders in a column the width of a phone, and the geometry in §3 stays
 * literally true rather than approximately true. **This is the cheap half of a real
 * decision**: the alternative is a desktop layout, which is weeks of design work that
 * contradicts "the board is the product — one screen, opened a hundred times a year".
 *
 * Native renders its children untouched. There is no shell on a device, because the device
 * *is* the shell.
 */

import type { ReactNode } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { color, radius, space, stroke } from '../theme/tokens';

/**
 * The column's width.
 *
 * 402 is §3's reference viewport — the one every measurement in the design system was
 * derived against — so a browser at this width lands on exactly the 66.8pt tiles the spec
 * describes. Any other number would make the design system's own numbers wrong.
 */
export const COLUMN = 402;

/**
 * Below this, the browser window *is* a phone and the shell is only in the way — a frame
 * drawn around a viewport that already fits wastes the little width there is. Above it,
 * there is room to show the column as a device rather than as a stranded strip of content.
 */
export const FRAME_FROM = 900;

/**
 * How wide the app actually is, as opposed to how wide the window is.
 *
 * On a handset those are the same number and `useWindowDimensions()` is the right question.
 * On web they are not: this component puts the app in a 402pt column, so a screen that sizes
 * anything from the window is sizing it from three times its own container.
 *
 * `app/year/wrapped.tsx` is where that showed. §3 calls a Wrapped card "full-bleed", which on
 * a phone means the window — so the card was `useWindowDimensions().width`, and in a browser
 * it rendered at 1440 inside a 402 column: clipped by the shell, with the 118pt numeral hard
 * against the left edge and the 2×2 stats grid off the side entirely.
 *
 * Derived rather than measured, and that is deliberate. An `onLayout` on the screen's own
 * root is the obvious answer and it does not work here: the value is needed by `FlatList`'s
 * `getItemLayout`, which is called before the first layout pass, so the first render is laid
 * out at the wrong width whatever the measurement later says. The shell already knows the
 * answer — it is the thing imposing it — so it should be the one asked.
 */
export function useAppWidth(): number {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? Math.min(width, COLUMN) : width;
}

export function PhoneShell({
  children,
  full = false,
}: {
  children: ReactNode;
  /**
   * Let this route have the whole window.
   *
   * One route does: `/`, the landing page, which is a **desktop page** rather than a screen
   * of the app. It is read once by somebody deciding whether to look further, on whatever
   * they happen to be holding, and 402pt of a 1440px window is a pamphlet slid under a door.
   * The app itself stays phone-shaped, because §3's geometry is only true at 402.
   *
   * **The two `<View>`s stay, and that is the point of a prop rather than a fragment.** An
   * opt-out that returned `<>{children}</>` would change the shape of the tree between two
   * routes, and React unmounts a subtree whose element type changes — so navigating from `/`
   * to `/signin` would tear down and rebuild the whole `<Stack>`, losing its history. Same
   * views, different constraint.
   */
  full?: boolean;
}) {
  const { width } = useWindowDimensions();

  // A device is already the right shape. This component has no business there, and
  // wrapping the tree in two extra views on every launch would be pure cost.
  if (Platform.OS !== 'web') return <>{children}</>;

  const framed = width >= FRAME_FROM && !full;

  return (
    <View
      style={{
        flex: 1,
        // `stretch` and not `center` when the page is taking the window: a centred child
        // with no max width still lays out at its content's size.
        alignItems: full ? 'stretch' : 'center',
        justifyContent: framed ? 'center' : 'flex-start',
        // The ground *outside* the phone. `paperSunk` rather than a new colour, because
        // §1.1 is the whole palette and this is a well the app sits in — the same job
        // `paperSunk` does behind a tile and a progress track.
        backgroundColor: framed ? color.paperSunk : color.paper,
      }}
    >
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: full ? undefined : COLUMN,
          backgroundColor: color.paper,
          // Lifted for the landing page only. The column clips on purpose — a sheet must not
          // escape the phone — but a page that *is* the window has nothing to escape from,
          // and `hidden` here would clip its own scrolling.
          overflow: full ? 'visible' : 'hidden',
          ...(framed
            ? {
                // A device, not a card: a tall radius and a hairline edge, and no shadow.
                // §1.2 says elevation is lightness rather than shadow, and although that
                // rule is written about dark mode the reason holds here — a drop shadow is
                // the one thing in this system that would look like a different product.
                marginVertical: space.xl,
                borderRadius: radius.sheet * 2,
                borderWidth: stroke.hairline,
                borderColor: color.hairline,
                // Tall enough to be a phone, short enough to fit a laptop with the browser
                // chrome taking its share. Bounded rather than fixed so a short window
                // shrinks it instead of clipping the bottom of the Board.
                maxHeight: 860,
              }
            : null),
        }}
      >
        {children}
      </View>
    </View>
  );
}
