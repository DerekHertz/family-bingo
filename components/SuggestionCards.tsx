/**
 * The two cards a sharpened Goal offers (FRONTEND_DESIGN §4.2).
 *
 * > "One suggestion, never a menu of rewrites, and the Member's own sentence always sits
 * > beside it as an equal card."
 *
 * The equality is the design, not a layout convenience. §7.5 promises that keeping your
 * own wording is a first-class outcome rather than a decline, so the two cards are the
 * same size, in the same list, with the same affordance — and **neither is selected when
 * they arrive**. Pre-selecting the sharpened one would make the Member's sentence the
 * thing being corrected, which is exactly the tone §7.6 rules out.
 *
 * `SHARPENED` takes the `moss` inset because accepting it is the growth-shaped move; the
 * Member's own card is a hairline, and never `clay` — clay means family and nothing else
 * (§1.1). There is no red anywhere, because there is no wrong answer here.
 */

import { Pressable, Text, View } from 'react-native';
import type { Suggestion } from '../src/domain/sharpen';
import { targetSummary } from '../src/domain/goal';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';

/** Which card the Member has picked. `null` until they pick one — §4.2. */
export type Choice = 'sharpened' | 'mine' | null;

interface Props {
  suggestion: Suggestion;
  mine: { text: string; target: number; unit: string | null };
  choice: Choice;
  onChoose: (choice: Choice) => void;
}

/** Target and pace as chips (§4.2). `pace_hint` is display only and stays that way (§6.3). */
function Chip({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radius.pill,
        backgroundColor: color.paperSunk,
      }}
    >
      <Text style={{ ...styles.meta, color: color.ink2 }}>{label}</Text>
    </View>
  );
}

function Card({
  heading,
  chosen,
  onPress,
  accessibilityLabel,
  children,
}: {
  heading: string;
  chosen: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        padding: space.md,
        borderRadius: radius.card,
        backgroundColor: color.paperRaised,
        // 1.5px inset when chosen, hairline when not (§4.2). The border width does not
        // change with selection — a card that grows a thicker edge shifts its own text.
        borderWidth: 1.5,
        borderColor: chosen ? color.moss : color.hairline,
        minHeight: size.minTouch,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={{ ...styles.meta, color: chosen ? color.mossDeep : color.ink3 }}>
          {heading}
        </Text>
        {/* The check is mossDeep rather than moss: any text on or of moss is mossDeep,
            for the 7.0:1 it carries on paper (§1.1). */}
        {chosen ? (
          <Text style={{ ...styles.label, color: color.mossDeep }}>✓</Text>
        ) : null}
      </View>
      {children}
    </Pressable>
  );
}

export function SuggestionCards({ suggestion, mine, choice, onChoose }: Props) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Which wording to save"
      style={{ gap: size.stack, marginTop: space.lg }}
    >
      <Card
        heading="SHARPENED"
        chosen={choice === 'sharpened'}
        onPress={() => onChoose('sharpened')}
        accessibilityLabel={`Sharpened: ${suggestion.text}, ${targetSummary(
          suggestion.target,
          suggestion.unit,
        )}`}
      >
        <Text style={{ ...styles.cardHead, color: color.ink, marginTop: space.xs }}>
          {suggestion.text}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
          <Chip label={targetSummary(suggestion.target, suggestion.unit)} />
          {suggestion.paceHint === null ? null : <Chip label={suggestion.paceHint} />}
        </View>
      </Card>

      <Card
        heading="AS YOU WROTE IT"
        chosen={choice === 'mine'}
        onPress={() => onChoose('mine')}
        accessibilityLabel={`As you wrote it: ${mine.text}, ${targetSummary(
          mine.target,
          mine.unit,
        )}`}
      >
        {/* `body` in `ink2` (§4.2) — quieter than the sharpened card's Shippori head, and
            deliberately not smaller. Equal weight, different voice. */}
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.xs }}>{mine.text}</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Chip label={targetSummary(mine.target, mine.unit)} />
        </View>
      </Card>
    </View>
  );
}
