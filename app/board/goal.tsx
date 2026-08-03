/**
 * One goal — Slice 6 (PRD §6, FRONTEND_DESIGN §4.1, "One goal").
 *
 * Full screen, keyboard up, one sentence and a number. The field is 22pt/400 Zen Kaku and
 * never Shippori: Shippori is never used on a control, and a field a finger lands in is a
 * control (§1.1).
 *
 * **Every saved Goal has a target**, defaulting to 1 — `stageOf` is meaningless without
 * one (§4.1), and `target = 1` IS the one-shot shape rather than a second kind of Goal
 * (§6.2, ADR-0002). The line under the stepper previews the verb the logging button will
 * carry all year, because that is the only moment the difference is visible.
 *
 * Not here yet: **"Sharpen it"**, which is slice 7. A Goal written now leaves
 * `unit_canonical` and `category` NULL and still counts everywhere except the aggregate
 * Wrapped cards (§6.1a) — so this screen is complete on its own terms, not a stub.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { useBoard, useClearGoal, useWriteGoal } from '../../lib/queries/boards';
import {
  GOAL_TEXT,
  UNIT_MAX,
  goalTextProblem,
  stepperHint,
  targetProblem,
  unitProblem,
} from '../../src/domain/goal';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/** The stepper's two halves. 44pt each — §6 A3's floor, and an 8-year-old's finger. */
function Step({ label, hint, onPress, disabled }: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: size.minTouch,
        height: size.minTouch,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.card,
        backgroundColor: color.paperRaised,
        borderWidth: 1,
        borderColor: color.hairline,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ ...styles.heading, color: color.ink }}>{label}</Text>
    </Pressable>
  );
}

export default function ComposeGoal() {
  const { boardId, tileId } = useLocalSearchParams<{ boardId: string; tileId: string }>();
  const router = useRouter();
  const board = useBoard(boardId);
  const write = useWriteGoal(boardId ?? '');
  const clear = useClearGoal(boardId ?? '');

  const tile = board.data?.find((t) => t.id === tileId);
  const existing = tile?.goal ?? null;

  // Seeded once from the cache and owned by the screen thereafter. Re-seeding on every
  // render would overwrite what is being typed the moment an invalidation lands.
  const [seeded, setSeeded] = useState(false);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState(1);
  const [trouble, setTrouble] = useState<string | null>(null);

  if (!seeded && board.data !== undefined) {
    setSeeded(true);
    if (existing !== null) {
      setText(existing.text);
      setUnit(existing.unit ?? '');
      setTarget(existing.target);
    }
  }

  const say = (message: string) => {
    setTrouble(message);
    // accessibilityLiveRegion is Android-only; iOS has to be told outright (§6 A6).
    AccessibilityInfo.announceForAccessibility(message);
  };

  if (board.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading the goal"
        />
      </View>
    );
  }

  const problem =
    goalTextProblem(text) ?? targetProblem(target) ?? unitProblem(unit);

  const save = () => {
    if (problem !== null) {
      say(problem);
      return;
    }
    write.mutate(
      {
        tileId: tileId ?? '',
        text,
        target,
        unit: unit.trim() === '' ? null : unit,
        // §6.1a: never typed here, and never invented. A Goal that skipped Sharpening
        // leaves both NULL, which is a supported state rather than missing data.
      },
      {
        onSuccess: () => router.back(),
        onError: (e) => {
          const raw = e instanceof Error ? e.message : '';
          say(
            /sealed/i.test(raw)
              ? 'This board has sealed. Changing a goal now costs a swap.'
              : /Center Tile|centre/i.test(raw)
                ? 'The centre square is the family’s, not yours to write.'
                : /not your Board/i.test(raw)
                  ? 'That board isn’t yours to write on.'
                  : /frozen/i.test(raw)
                    ? 'This year has finished.'
                    : 'That didn’t save. Have another go in a moment.',
          );
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop }}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={{ ...styles.title, color: color.ink }}>
          {existing === null ? 'Write a goal' : 'This goal'}
        </Text>

        <TextInput
          value={text}
          onChangeText={setText}
          // No `maxLength`. Truncating mid-word as somebody types is the app deciding it
          // knows better; goalTextProblem() says so in words instead, and only on save.
          placeholder="Read more books"
          placeholderTextColor={color.ink3}
          multiline
          autoFocus={existing === null}
          accessibilityLabel="The goal"
          accessibilityHint={`Up to ${GOAL_TEXT.max} characters`}
          style={{
            ...styles.compose,
            marginTop: space.lg,
            minHeight: 96,
            padding: space.md,
            color: color.ink,
            backgroundColor: color.paperRaised,
            borderWidth: 1,
            borderColor: color.hairline,
            borderRadius: radius.card,
            textAlignVertical: 'top',
          }}
        />

        <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xl }}>
          How many times
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm }}>
          <Step
            label="−"
            hint="One fewer"
            disabled={target <= 1}
            onPress={() => setTarget((n) => Math.max(1, n - 1))}
          />
          <TextInput
            value={String(target)}
            onChangeText={(next) => {
              // Digits only, and an empty field reads as 1 rather than as NaN — a Member
              // clearing the box to type "12" must not see the screen refuse in between.
              const digits = next.replace(/[^0-9]/g, '');
              setTarget(digits === '' ? 1 : Math.min(100_000, Number(digits)));
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            accessibilityLabel="Target"
            style={{
              ...styles.compose,
              minWidth: 72,
              height: size.minTouch,
              paddingHorizontal: space.md,
              textAlign: 'center',
              color: color.ink,
              backgroundColor: color.paperRaised,
              borderWidth: 1,
              borderColor: color.hairline,
              borderRadius: radius.card,
            }}
          />
          <Step label="+" hint="One more" disabled={false} onPress={() => setTarget((n) => n + 1)} />

          <TextInput
            value={unit}
            onChangeText={setUnit}
            // The Member's own wording (§6.1). Nothing corrects it and nothing pluralises
            // it — `unit_canonical` is Sharpening's job (§7.10) and is never typed here.
            placeholder="books"
            placeholderTextColor={color.ink3}
            autoCapitalize="none"
            maxLength={UNIT_MAX}
            accessibilityLabel="What you are counting, if you like"
            style={{
              ...styles.body,
              flex: 1,
              height: size.minTouch,
              paddingHorizontal: space.md,
              color: color.ink,
              backgroundColor: color.paperRaised,
              borderWidth: 1,
              borderColor: color.hairline,
              borderRadius: radius.card,
            }}
          />
        </View>

        {/* §4.1: the resulting increment verb, previewed beside the stepper. */}
        <Text
          accessibilityLiveRegion="polite"
          style={{ ...styles.label, color: color.ink2, marginTop: space.md }}
        >
          {stepperHint(target, unit.trim() === '' ? null : unit)}
        </Text>

        {trouble === null ? null : (
          <Text
            accessibilityLiveRegion="polite"
            style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}
          >
            {trouble}
          </Text>
        )}

        <Button
          label={write.isPending ? 'Saving…' : 'Save this goal'}
          variant="primary"
          disabled={write.isPending || clear.isPending}
          style={{ marginTop: space.xl }}
          onPress={save}
        />

        {/* §6.4, §10.2 — emptying a Tile is legitimate right up to the deadline. clayDeep
            on paper: there is no red in this palette (§1.1). */}
        {existing === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear this square"
            disabled={clear.isPending || write.isPending}
            onPress={() =>
              Alert.alert('Clear this square?', 'The goal goes; the square stays empty.', [
                { text: 'Keep it', style: 'cancel' },
                {
                  text: 'Clear it',
                  onPress: () =>
                    clear.mutate(tileId ?? '', {
                      onSuccess: () => router.back(),
                      onError: () => say('That didn’t clear. Have another go in a moment.'),
                    }),
                },
              ])
            }
            style={{
              minHeight: size.control,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: space.sm,
            }}
          >
            <Text style={{ ...styles.label, color: color.clayDeep }}>Clear this square</Text>
          </Pressable>
        )}

        <Button
          label="Not now"
          variant="text"
          disabled={write.isPending || clear.isPending}
          style={{ marginTop: space.sm }}
          onPress={() => router.back()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
