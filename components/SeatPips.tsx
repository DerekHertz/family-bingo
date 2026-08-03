/**
 * "4 of 20. Sixteen invitations left." (FRONTEND_DESIGN §4.5)
 *
 * > Seats render as a pip row on `paperSunk` — pips, never a progress bar, because twenty
 * > fit on one line and nobody should read a fraction.
 *
 * A progress bar would also imply filling the Family is the goal. It is not; twenty is a
 * ceiling, not a target.
 */

import { Text, View } from 'react-native';
import { styles } from '../theme/fonts';
import { color, radius, space } from '../theme/tokens';

const WORDS = [
  'No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen', 'Twenty',
] as const;

export function SeatPips({ taken, total }: { taken: number; total: number }) {
  const left = Math.max(0, total - taken);
  const full = left === 0;

  return (
    <View
      accessible
      accessibilityLabel={
        full
          ? `${taken} of ${total} seats. Full for now.`
          : `${taken} of ${total} seats. ${WORDS[left] ?? left} invitations left.`
      }
      style={{
        gap: space.sm,
        padding: space.md,
        backgroundColor: color.paperSunk,
        borderRadius: radius.card,
      }}
    >
      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: radius.pill,
              backgroundColor: i < taken ? color.moss : color.paperSunk,
            }}
          />
        ))}
      </View>
      {/* `label`, not `meta`: meta upper-cases, and "4 OF 20. SIXTEEN INVITATIONS LEFT."
          is shouting a fact §4.5 wants stated quietly. */}
      <Text style={{ ...styles.label, color: color.ink2 }}>
        {full
          ? `${taken} of ${total}. Full for now.`
          : `${taken} of ${total}. ${WORDS[left] ?? left} invitations left.`}
      </Text>
    </View>
  );
}
