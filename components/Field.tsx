/**
 * A field somebody types into (FRONTEND_DESIGN §1.1, §4).
 *
 * Nine style properties — the type, the ink, `paperRaised`, a hairline, `radius.card`, the
 * padding and the height — written out eight times across five screens, with each copy free
 * to drift a point. The one that matters most is the rule §1.1 states and this enforces:
 *
 * > Shippori Mincho is never used below 19pt and **never on a control** — no buttons, no
 * > tabs, no labels, nothing a finger touches.
 *
 * A field is something a finger lands in, so both `tone`s here are Zen Kaku and there is no
 * third. `compose` is the 22pt/400 §4.1 gives the one goal being written; `body` is
 * everything else.
 *
 * `styles`, never a raw `type` token — a raw token names the design system's family, which
 * the renderer has never loaded, so the text silently falls back to the system font
 * (theme/fonts.ts).
 */

import type { TextInputProps, TextStyle } from 'react-native';
import { TextInput } from 'react-native';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';

interface Props extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /** §4.1's 22pt compose field, or `body` for everything else. Never Shippori (§1.1). */
  tone?: 'body' | 'compose';
  /**
   * A field that grows with what is typed into it.
   *
   * It changes the box rather than just the flag: a fixed `height` becomes a `minHeight`,
   * the horizontal padding becomes padding all round, and the text top-aligns — a
   * multiline field whose text sits vertically centred looks like a single-line field
   * that has gone wrong.
   */
  multiline?: boolean;
  /** The row height, or the floor when `multiline`. Defaults to §4's 52pt control. */
  height?: number;
  /** Merged last, like `<Button>`'s: position, width and alignment are the caller's. */
  style?: TextStyle;
}

export function Field({
  tone = 'body',
  multiline = false,
  height = size.control,
  style,
  ...rest
}: Props) {
  return (
    <TextInput
      {...rest}
      multiline={multiline}
      // `ink3` is decorative and a placeholder is exactly that (§1.1). Never `ink2`, which
      // would make a hint look like something the Member wrote.
      placeholderTextColor={color.ink3}
      style={{
        ...styles[tone],
        ...(multiline
          ? { minHeight: height, padding: space.md, textAlignVertical: 'top' }
          : { height, paddingHorizontal: space.md }),
        color: color.ink,
        backgroundColor: color.paperRaised,
        borderWidth: 1,
        borderColor: color.hairline,
        borderRadius: radius.card,
        ...style,
      }}
    />
  );
}
