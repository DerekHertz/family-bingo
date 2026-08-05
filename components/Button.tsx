/**
 * Every button in this app (FRONTEND_DESIGN §4, §1.1, §6 A3).
 *
 * `filled` is `ink` — not moss. Moss is growth's colour, and a sign-in button has not
 * grown anything. `outlined` is `paperRaised` inside a hairline. `text` is text.
 *
 * Never Shippori: it is never used on a control, nothing a finger touches (§1.1).
 * Minimum height is 52pt here and never below 44 anywhere (§6 A3).
 *
 * Four controls used to re-implement this rather than use it — "Sharpen it", the tile
 * sheet's log button, "We did it" and "Add a note". They needed three things this did not
 * have, and each is a prop below rather than a new variant, because a variant is a name for
 * a *kind* of button and none of them was a new kind: `height`, `tone`, and `onPressIn`
 * for §5's touch-down haptic.
 */

import { Pressable, Text, type ViewStyle } from 'react-native';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  /**
   * `primary` is §4.5's 56pt moss commit button — creating a Family, logging an Increment.
   * `filled` is `ink`, for signing in, where nothing has grown yet and moss would be a lie.
   */
  variant?: 'primary' | 'filled' | 'outlined' | 'text';
  /**
   * What a `primary` button is *about*, and it changes only the fill.
   *
   * `moss` is growth and is the default. `clay` is the Family and nothing else (§1.1) —
   * §4.3's "We did it" on the shared Centre, which is the one button in the app that
   * speaks for more than the person pressing it. It fills in `clayDeep` rather than `clay`,
   * because the label on it is `paper` and `clayDeep` is the tone that carries text (§1.1).
   *
   * Ignored on the other three variants: `filled` is `ink` by §4's sign-in row, and there
   * is nothing to tone about a border or a word.
   */
  tone?: 'moss' | 'clay';
  /**
   * Overrides the variant's own height — §4.1's "Sharpen it" is 46pt, deliberately below
   * a real control so asking for a suggestion never looks like the way forward.
   *
   * Whatever is passed, §6 A3's 44pt floor still applies underneath it.
   */
  height?: number;
  disabled?: boolean;
  /**
   * §5 — "haptic on touch-down, not on server response". The tap is the reward and it
   * should land under the finger; whether the row saved is the ring's business.
   */
  onPressIn?: () => void;
  /**
   * §6 A6 — "every Increment button has an explicit accessible label including the goal
   * text. 'Walked one' alone is meaningless out of context." Defaults to the visible
   * label, which is right for every button whose words stand on their own.
   */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'outlined',
  tone = 'moss',
  height,
  disabled = false,
  onPressIn,
  accessibilityLabel,
  accessibilityHint,
  style,
}: Props) {
  const primary = variant === 'primary';
  const filled = variant === 'filled' || primary;
  const plain = variant === 'text';
  const wanted = height ?? (primary ? size.controlPrimary : size.control);

  return (
    <Pressable
      onPress={onPress}
      {...(onPressIn === undefined ? {} : { onPressIn })}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        // Room for a label that has grown. Inert at the default sizes, where the text is
        // far shorter than the box — it only does anything once §6 A4's Dynamic Type has
        // pushed the words past the height below.
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.card,
        backgroundColor: plain
          ? 'transparent'
          : primary
            ? tone === 'clay'
              ? color.clayDeep
              : color.moss
            : filled
              ? color.ink
              : color.paperRaised,
        borderWidth: plain || filled ? 0 : 1,
        borderColor: color.hairline,
        // No pressed colour of its own: the palette has no state colours, so press is
        // opacity (§1.1).
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        ...style,
        // After the caller's overrides, never under §6 A3's floor. A layout tweak must not
        // be able to shrink a touch target below the size an 8-year-old can hit (§0.4).
        //
        // A **floor**, not a fixed height, and that is §6 A4: Dynamic Type runs to XXL
        // everywhere except the board, and a `height: 56` truncates the tile sheet's label
        // at XXL instead of growing with it. The sheet is where larger text is meant to
        // live, so the button has to grow with it.
        minHeight: Math.max(size.minTouch, wanted),
      })}
    >
      <Text
        style={{
          // §4: 17pt/700 — `type.action`, which exists for exactly this. It used to be
          // `heading` with `fontSize: 17` written over it, which is the same size and the
          // wrong lineHeight (26 against 22). Resolved through `styles`, never a raw token:
          // a raw token names the design system's family, which the renderer has never
          // heard of.
          ...styles.action,
          color: filled ? color.paper : plain ? color.ink2 : color.ink,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
