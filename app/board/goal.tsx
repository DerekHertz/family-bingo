/**
 * One goal — Slices 6 and 7 (PRD §6 and §7, FRONTEND_DESIGN §4.1 and §4.2).
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
 * ## Sharpening (§7.5, the most important requirement in the PRD)
 *
 * **Sharpening never blocks, and this screen is where that is won or lost.** There is no
 * validity check, no rejection, no "your goal isn't specific enough". Three things make it
 * structural here rather than aspirational:
 *
 *   1. **"Sharpen it" saves first.** The Goal is written exactly as typed *before* the
 *      model is asked. §7.9 says "never lose input", and the only way to be sure of that
 *      is for the input to already be safe when the call goes out. It also makes §7.9's
 *      copy true rather than optimistic: "Couldn't get suggestions — saved as you wrote
 *      it" is a statement of fact, because it was.
 *   2. **Nothing is disabled while it runs** (§4.2). No overlay, no spinner over the
 *      form. The Member can keep typing, save again, or leave — the answer is optional and
 *      the screen behaves like it.
 *   3. **Nothing is pre-selected** (§4.2). The two cards arrive equal, and the Member's own
 *      sentence sits beside the suggestion as a peer rather than as the thing being fixed.
 *
 * **One sharpen per Goal, and no reroll after a successful one** — a rerollable sharpener
 * turns writing a goal into a slot machine (§4.2). A *failed* call is offered again,
 * because a failure does not spend the sharpen and refusing to retry would be a dead end
 * §7.9 rules out.
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
import { SuggestionCards, type Choice } from '../../components/SuggestionCards';
import { useBoard, useBoardHead, useClearGoal, useWriteGoal } from '../../lib/queries/boards';
import { useSharpen } from '../../lib/queries/sharpen';
import { useSession } from '../../lib/session';
import {
  GOAL_TEXT,
  UNIT_MAX,
  goalTextProblem,
  stepperHint,
  targetProblem,
  unitProblem,
} from '../../src/domain/goal';
import {
  type Suggestion,
  acceptSuggestion,
  keepOwnWords,
} from '../../src/domain/sharpen';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/**
 * A ceiling on the typed target. Not a domain rule — `write_goal()` accepts any positive
 * int — but a field that reads a pasted phone number as a target of nine billion produces
 * a Tile nobody can ever complete, and no keystroke gets you here by accident.
 */
const TARGET_CEILING = 100_000;

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
  const session = useSession();
  const board = useBoard(boardId);
  const head = useBoardHead(boardId, session?.user.id);
  const write = useWriteGoal(boardId ?? '');
  const clear = useClearGoal(boardId ?? '');
  const sharpen = useSharpen();

  const tile = board.data?.find((t) => t.id === tileId);
  const existing = tile?.goal ?? null;

  // Seeded once from the cache and owned by the screen thereafter. Re-seeding on every
  // render would overwrite what is being typed the moment an invalidation lands.
  const [seeded, setSeeded] = useState(false);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState(1);
  const [trouble, setTrouble] = useState<string | null>(null);

  // §4.2's three states, as two pieces of state. `suggestion` non-null is "answered";
  // `sharpen.isPending` is "working"; `sharpenFailed` is the third.
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [sharpenFailed, setSharpenFailed] = useState(false);

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

  const mine = { text, target, unit: unit.trim() === '' ? null : unit };

  /**
   * What actually gets written, given which card is selected.
   *
   * `null` selects nothing new: it is the plain slice-6 save, and it is also what a Member
   * gets if they edit the fields by hand after the cards appear. Both cards stay editable
   * afterwards, so refinement is manual rather than another model call (§4.2).
   */
  const resolved =
    choice === 'sharpened' && suggestion !== null
      ? acceptSuggestion(suggestion)
      : keepOwnWords(mine, suggestion);

  const save = (
    goal = resolved,
    { andLeave = true }: { andLeave?: boolean } = {},
  ) => {
    if (problem !== null) {
      say(problem);
      return;
    }
    write.mutate(
      {
        tileId: tileId ?? '',
        text: goal.text,
        target: goal.target,
        unit: goal.unit,
        // §6.1a: never typed, never invented — these only ever come back from Sharpening
        // (§7.10). A Goal that skipped it leaves both NULL, which is a supported state
        // rather than missing data.
        unitCanonical: goal.unitCanonical,
        category: goal.category,
        paceHint: goal.paceHint,
      },
      {
        onSuccess: () => {
          if (andLeave) router.back();
        },
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

  /**
   * §4.2's "Working" state, and §7.9's promise, in one action.
   *
   * The Goal is saved as typed **before** the model is asked. That ordering is the whole
   * guarantee: whatever happens next — timeout, refusal, the Member closing the app mid-call
   * — their words are already on the Tile. It also makes the failure copy honest rather
   * than hopeful, because "saved as you wrote it" has already happened by the time it is
   * shown.
   */
  const askToSharpen = () => {
    if (problem !== null) {
      say(problem);
      return;
    }
    setTrouble(null);
    setSharpenFailed(false);
    // Not `andLeave` — the Member stays here to see the answer.
    save(keepOwnWords(mine, null), { andLeave: false });

    sharpen.mutate(
      { text, memberId: head.data?.memberId ?? '', yearId: head.data?.year.id ?? '' },
      {
        onSuccess: (result) => {
          if (result.suggestion === null) {
            setSharpenFailed(true);
            // §7.9's exact promise, and no more than it. No red, no retry modal, no dead
            // end — and never a word suggesting the Member's goal was the problem.
            say(
              result.reason === 'budget_spent'
                ? 'That’s all the sharpening this year. Your goal is saved as you wrote it.'
                : 'Couldn’t get a suggestion just now. Your goal is saved as you wrote it.',
            );
            return;
          }
          setSuggestion(result.suggestion);
          // Nothing is pre-selected on the Member's behalf (§4.2).
          setChoice(null);
        },
        // useSharpen never rejects (§7.5) — this is here so a future change to that
        // cannot silently turn a failed suggestion into a stuck spinner.
        onError: () => {
          setSharpenFailed(true);
          say('Couldn’t get a suggestion just now. Your goal is saved as you wrote it.');
        },
      },
    );
  };

  // One sharpen per Goal, and no reroll after a successful one — a rerollable sharpener
  // turns writing a goal into a slot machine (§4.2). `category` is the durable half of
  // that rule: it is set by both cards, so reopening a Goal that has been through
  // Sharpening does not offer it again. A failure is offered again, because a failure
  // does not spend the sharpen.
  const alreadySharpened = suggestion !== null || existing?.category != null;
  const canSharpen = head.data?.controlled === true && !alreadySharpened;

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
              if (digits === '') {
                setTarget(1);
                return;
              }
              const wanted = Number(digits);
              // The one place the screen changes what was typed, so it says so rather
              // than silently swallowing the extra digits.
              if (wanted > TARGET_CEILING) say(`Targets stop at ${TARGET_CEILING.toLocaleString()}.`);
              setTarget(Math.min(TARGET_CEILING, wanted));
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

        {/* §4.1: the resulting increment verb, previewed beside the stepper.

            Deliberately NOT a live region. It was one, and on Android that meant the whole
            sentence was announced on every keystroke in the unit field — "1 b · the button
            will say Did it", "1 bo · …". The text sits directly under the controls that
            change it and is read on focus like any other label. */}
        <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
          {stepperHint(target, unit.trim() === '' ? null : unit)}
        </Text>

        {/* §4.2, "Sharpen it". 46pt, and below the fields rather than beside them: it acts
            on what is written above it, so it reads down. Absent once a suggestion has
            been given — one sharpen per Goal, no reroll. */}
        {canSharpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sharpen it"
            accessibilityHint="Suggests a countable version. Your own wording is always kept as an option."
            // Never disabled while the call is out (§4.2, "no disabled control"). Tapping
            // again during a call is harmless: the mutation replaces its own result.
            onPress={askToSharpen}
            style={({ pressed }) => ({
              height: size.controlSharpen,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: space.lg,
              borderRadius: radius.card,
              backgroundColor: color.paperRaised,
              borderWidth: 1,
              borderColor: color.hairline,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...styles.heading, fontSize: 17, color: color.ink }}>
              {sharpen.isPending ? 'Sharpening…' : 'Sharpen it'}
            </Text>
          </Pressable>
        ) : null}

        {/* The "Working" pill (§4.2). `ink3`, no overlay, nothing disabled — the Member can
            keep typing, save, or leave while the model thinks. */}
        {sharpen.isPending ? (
          <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.sm, textAlign: 'center' }}>
            SHARPENING… YOU CAN CARRY ON
          </Text>
        ) : null}

        {/* The "Answered" state. Two equal cards, nothing pre-selected. */}
        {suggestion === null ? null : (
          <SuggestionCards
            suggestion={suggestion}
            mine={mine}
            choice={choice}
            onChoose={setChoice}
          />
        )}

        {/* `say()` already calls announceForAccessibility, which is the only one iOS
            honours. Pairing it with a live region made Android say everything twice.

            This is also where the "Refused / slow / malformed" state lands (§4.2): plain
            words in `ink2`, no red, no retry modal, and the Goal already saved. */}
        {trouble === null ? null : (
          <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>{trouble}</Text>
        )}

        <Button
          label={
            write.isPending
              ? 'Saving…'
              : suggestion !== null && choice === null
                ? 'Pick one to save'
                : 'Save this goal'
          }
          variant="primary"
          // Once two cards are on screen, saving means choosing between them. Left enabled
          // and unpicked it would silently save one of the two, which is the pre-selection
          // §4.2 rules out wearing a different hat.
          disabled={
            write.isPending || clear.isPending || (suggestion !== null && choice === null)
          }
          style={{ marginTop: space.xl }}
          onPress={() => save()}
        />

        {/* A failure does not spend the sharpen (§4.2), so offering it again is honest —
            and refusing to would be the dead end §7.9 rules out. Only after a failure:
            there is no reroll on a suggestion that arrived. */}
        {sharpenFailed && !sharpen.isPending ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try sharpening again"
            onPress={askToSharpen}
            style={{ minHeight: size.minTouch, alignItems: 'center', justifyContent: 'center', marginTop: space.sm }}
          >
            <Text style={{ ...styles.label, color: color.ink2 }}>Try sharpening again</Text>
          </Pressable>
        ) : null}

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
