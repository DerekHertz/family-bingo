/**
 * A Member, as a circle (FRONTEND_DESIGN §3, §4.5).
 *
 * Three states: joined, invited-but-not-joined (a hairline ring at 75%, "invited" in
 * meta), and Managed — which carries an 11pt clay dot bottom-right everywhere they appear.
 *
 * > the dot makes the relationship visible without naming the Guardian in the row.
 *
 * No red "pending" badge, and no resend nag: §4.5 rules both out, and there is no red in
 * the palette to build one from anyway (§1.1).
 */

import { Text, View } from 'react-native';
import { styles } from '../theme/fonts';
import { color, radius } from '../theme/tokens';

interface Props {
  name: string;
  size?: number;
  pending?: boolean;
  managed?: boolean;
}

export function Avatar({ name, size = 44, pending = false, managed = false }: Props) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';

  return (
    <View style={{ width: size, height: size, opacity: pending ? 0.75 : 1 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pending ? 'transparent' : color.paperSunk,
          borderWidth: pending ? 1 : 0,
          borderColor: color.hairline,
        }}
      >
        <Text style={{ ...styles.label, color: pending ? color.ink3 : color.ink2 }}>
          {pending ? '' : initial}
        </Text>
      </View>
      {managed ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 11,
            height: 11,
            borderRadius: radius.pill,
            backgroundColor: color.clay,
            borderWidth: 1.5,
            borderColor: color.paper,
          }}
        />
      ) : null}
    </View>
  );
}
