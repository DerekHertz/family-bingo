/**
 * The three button shapes this app has (FRONTEND_DESIGN §4, §1.1).
 *
 * `filled` is `ink` — not moss. Moss is growth's colour, and a sign-in button has not
 * grown anything. `outlined` is `paperRaised` inside a hairline. `text` is text.
 *
 * Never Shippori: it is never used on a control, nothing a finger touches (§1.1).
 * Minimum height is 52pt here and never below 44 anywhere (§6 A3).
 */

import { Pressable, Text, type ViewStyle } from 'react-native';
import { color, radius, type } from '../theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outlined' | 'text';
  disabled?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'outlined',
  disabled = false,
  accessibilityHint,
  style,
}: Props) {
  const filled = variant === 'filled';
  const plain = variant === 'text';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.card,
        backgroundColor: plain ? 'transparent' : filled ? color.ink : color.paperRaised,
        borderWidth: plain || filled ? 0 : 1,
        borderColor: color.hairline,
        // No pressed colour of its own: the palette has no state colours, so press is
        // opacity (§1.1).
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        ...style,
      })}
    >
      <Text
        style={{
          ...type.body,
          fontWeight: '700',
          fontSize: 17,
          color: filled ? color.paper : plain ? color.ink2 : color.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
