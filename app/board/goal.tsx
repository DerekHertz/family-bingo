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

import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Alert, Pressable, Text, View } from 'react-native';
import { leaveTo } from '../../lib/leave';
import { Button } from '../../components/Button';
import { ConfirmSheet, type Confirmation } from '../../components/ConfirmSheet';
import { Field } from '../../components/Field';
import { FormScreen, Loading, Trouble } from '../../components/Screen';
import { SuggestionCards, type Choice } from '../../components/SuggestionCards';
import { useAnnounce } from '../../lib/announce';
import {
  useBoard,
  useBoardHead,
  useClearGoal,
  useWriteGoal,
  writeGoalFailureCopy,
} from '../../lib/queries/boards';
import { useSharpen } from '../../lib/queries/sharpen';
import { useSession } from '../../lib/session';
import {
  GOAL_TEXT,
  UNIT_MAX,
  goalTextProblem,
  targetProblem,
  unitProblem,
  TARGET_CEILING,
} from '../../src/domain/goal';
import { stepperHint } from '../../src/domain/increment';
import { type Suggestion, authoredFrom, keepOwnWords } from '../../src/domain/sharpen';
import { styles } from '../../theme/fonts';
import { color, radius, size, space, stroke } from '../../theme/tokens';

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
        borderWidth: stroke.hairline,
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
  const session = useSession();
  const board = useBoard(boardId, session?.user.id);
  const head = useBoardHead(boardId, session?.user.id);
  const write = useWriteGoal(boardId ?? '');
  const clear = useClearGoal(boardId ?? '');
  const sharpen = useSharpen();

  const tile = board.data?.find((t) => t.id === tileId);
  const existing = tile?.goal ?? null;

  // Seeded once from the cache and owned by the screen thereafter. Re-seeding on every
  // render would overwrite what is being typed the moment an invalidation lands.
  const [seeded, setSeeded] = useState(false);
  // `Alert.alert` is a no-op on react-native-web, so this confirm did nothing on the
  // deployed build — see components/ConfirmSheet.tsx.
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState(1);
  // Renamed on the way in: `clear` is already the `clear_goal()` mutation on this screen,
  // and emptying a Tile is not the same act as taking a sentence off the screen.
  const { trouble, say, clear: clearTrouble } = useAnnounce();

  // §4.2's three states, as two pieces of state. `suggestion` non-null is "answered";
  // `sharpen.isPending` is "working"; `sharpenFailed` is the third.
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [sharpenFailed, setSharpenFailed] = useState(false);
  /**
   * The Member's own words, target and unit at the moment they asked.
   *
   * A snapshot rather than a live read, because choosing SHARPENED overwrites the fields
   * — and the AS YOU WROTE IT card has to keep showing what they actually wrote. Without
   * it that card renders whatever is in the fields, which after one tap is the model's
   * wording under a heading claiming it is theirs.
   */
  const [askedWith, setAskedWith] = useState<{
    text: string;
    target: number;
    unit: string | null;
  } | null>(null);
  /** True only for the save that runs *before* the model is asked, so it can be excluded
   *  from the Save button's pending state — §4.2: "Save stays enabled". */
  const [presaving, setPresaving] = useState(false);

  if (!seeded && board.data !== undefined) {
    setSeeded(true);
    if (existing !== null) {
      setText(existing.text);
      setUnit(existing.unit ?? '');
      setTarget(existing.target);
    }
  }

  if (board.isPending) return <Loading what="Loading the goal" />;

  const problem =
    goalTextProblem(text) ?? targetProblem(target) ?? unitProblem(unit);

  const mine = { text, target, unit: unit.trim() === '' ? null : unit };

  /**
   * Whether the suggestion still describes what is in the fields.
   *
   * The fields stay editable after the cards arrive (§4.2), so the Member can replace
   * "take a walk every day" with "save for a house" and then tap AS YOU WROTE IT. Without
   * this the walking suggestion's `category: 'fitness'` would ride along onto a money
   * goal and put it in the wrong Wrapped bucket (§20.5) — the same failure the
   * `unitCanonical` guard already prevents, on the field that had no guard.
   *
   * Either wording counts as still-this-goal: the words it was sharpened FROM, or the
   * words it was sharpened INTO.
   */
  const suggestionApplies =
    suggestion !== null &&
    askedWith !== null &&
    (text.trim() === askedWith.text.trim() || text.trim() === suggestion.text.trim());

  /**
   * What gets written — always resolved from the live fields.
   *
   * Choosing SHARPENED copies the suggestion into the fields rather than shadowing them,
   * so from that moment there is one source of truth and an edit afterwards is simply an
   * edit. It read `acceptSuggestion(suggestion)` directly, which meant a Member who
   * picked the card and then nudged the target from 300 down to 150 watched 300 get
   * saved — §4.2 invites that edit and the screen threw it away.
   */
  const resolved = authoredFrom(mine, suggestionApplies ? suggestion : null);

  /**
   * Write the Goal. Resolves `true` when it landed, so a caller can tell.
   *
   * `mutateAsync` rather than `mutate` because `askToSharpen` has to KNOW: it saves the
   * Member's words before asking the model, and if that save failed then "your goal is
   * saved as you wrote it" is a lie told to somebody who is about to lose their typing.
   */
  const save = async (
    goal = resolved,
    { andLeave = true, sharpened = false }: { andLeave?: boolean; sharpened?: boolean } = {},
  ): Promise<boolean> => {
    if (problem !== null) {
      say(problem);
      return false;
    }
    try {
      await write.mutateAsync({
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
        // Records that this Goal's one sharpen is spent (§4.2). A column rather than an
        // inference from `category`, which a null category and the pre-save both defeated.
        sharpened,
      });
      if (andLeave) leaveTo({ pathname: '/board/[id]', params: { id: boardId ?? '' } });
      return true;
    } catch (e) {
      // The copy for every `write_goal()` refusal lives beside the mutation that makes
      // the call, so it is read against the migration rather than against this screen.
      say(writeGoalFailureCopy(e));
      return false;
    }
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
  const askToSharpen = async () => {
    if (problem !== null) {
      say(problem);
      return;
    }
    clearTrouble();
    setSharpenFailed(false);

    // The save is AWAITED, and its outcome decides what the failure copy is allowed to
    // say. It used to be fired and forgotten, which made the reassurance a lie in the one
    // situation it mattered: offline, `write_goal` failed, and the sharpen result arrived
    // afterwards and overwrote "That didn't save" with "Your goal is saved as you wrote
    // it." A Member who then tapped "Not now" lost their words to a screen that had just
    // promised otherwise — §7.9's whole point, inverted.
    //
    // A failed save also stops the sharpen outright. There is no reason to spend a model
    // call, or a unit of §7.8's budget, on a Goal that is not on disk.
    setPresaving(true);
    const stored = await save(keepOwnWords(mine, null), { andLeave: false });
    setPresaving(false);
    if (!stored) return;

    setAskedWith(mine);

    sharpen.mutate(
      { text: mine.text, memberId: head.data?.memberId ?? '', yearId: head.data?.year.id ?? '' },
      {
        onSuccess: (result) => {
          if (result.suggestion === null) {
            setSharpenFailed(true);
            // §7.9's exact promise — and true, because the await above confirmed it. No
            // red, no retry modal, no dead end, and never a word suggesting the Member's
            // goal was the problem.
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
          // Two cards appear below the fold with no sound and no movement. A sighted
          // Member may scroll; a VoiceOver one has nothing at all to go on (§6 A6).
          AccessibilityInfo.announceForAccessibility(
            'Two wordings to choose from: sharpened, or as you wrote it.',
          );
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

  /**
   * Choosing a card fills the fields from it, rather than shadowing them.
   *
   * This is what makes §4.2's "both cards stay editable by hand afterwards" true. It also
   * removes the second source of truth: after this, the fields are the Goal, and `save`
   * has nothing to reconcile.
   */
  const choose = (next: Choice) => {
    setChoice(next);
    if (next === 'sharpened' && suggestion !== null) {
      setText(suggestion.text);
      setTarget(suggestion.target);
      setUnit(suggestion.unit ?? '');
    } else if (next === 'mine' && askedWith !== null) {
      setText(askedWith.text);
      setTarget(askedWith.target);
      setUnit(askedWith.unit ?? '');
    }
  };

  // One sharpen per Goal, and no reroll after a successful one — a rerollable sharpener
  // turns writing a goal into a slot machine (§4.2). A failure IS offered again, because
  // a failure does not spend the sharpen.
  //
  // `sharpened_at` (migration 33) rather than the presence of a `category`, which was an
  // inference and wrong twice over: the pre-save writes the Member's own words with no
  // category at all, so backing out of the cards and reopening the Tile offered a fresh
  // sharpen — one navigation per reroll, which is the slot machine itself — and a model
  // response whose category fell outside the seven-member enum left the Goal rerollable
  // for good. A rule enforced by inference is not a rule.
  const alreadySharpened = suggestion !== null || existing?.sharpened_at != null;
  // A failed head read is a real state, and silence is the wrong answer to it: the button
  // would simply be absent, indistinguishable from a Goal that has already been sharpened.
  // Saying so costs one line and turns a mystery into a fact (§0.3 — plain words, no red).
  const headUnknown = head.isError || (!head.isPending && head.data == null);
  const canSharpen = head.data?.controlled === true && !alreadySharpened;

  return (
    <FormScreen>
      <Text accessibilityRole="header" style={{ ...styles.title, color: color.ink }}>
        {existing === null ? 'Write a goal' : 'This goal'}
      </Text>

      <Field
        value={text}
        onChangeText={setText}
        // No `maxLength`. Truncating mid-word as somebody types is the app deciding it
        // knows better; goalTextProblem() says so in words instead, and only on save.
        placeholder="Read more books"
        // §4.1's 22pt compose face, and the taller box that goes with it.
        tone="compose"
        multiline
        height={96}
        autoFocus={existing === null}
        accessibilityLabel="The goal"
        accessibilityHint={`Up to ${GOAL_TEXT.max} characters`}
        style={{ marginTop: space.lg }}
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
        <Field
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
          tone="compose"
          // §6 A3's floor rather than the 52pt control, because it sits in a row between
          // two 44pt steppers and a taller box would break the line.
          height={size.minTouch}
          style={{ minWidth: 72, textAlign: 'center' }}
        />
        <Step label="+" hint="One more" disabled={false} onPress={() => setTarget((n) => n + 1)} />

        <Field
          value={unit}
          onChangeText={setUnit}
          // The Member's own wording (§6.1). Nothing corrects it and nothing pluralises
          // it — `unit_canonical` is Sharpening's job (§7.10) and is never typed here.
          placeholder="books"
          autoCapitalize="none"
          maxLength={UNIT_MAX}
          accessibilityLabel="What you are counting, if you like"
          height={size.minTouch}
          style={{ flex: 1 }}
        />
      </View>

      {/* §4.1: the resulting increment verb, previewed beside the stepper.

          The unit AND the existing Goal's `unit_canonical` both go in, because the
          preview has to be the same function the tile sheet's button calls. Passing the
          target alone reached a second rule that answered "+1" for anything above one,
          so a Goal with unit "books" was promised "+1" here and shipped "Read one" for
          the Year. `unit_canonical` is read from the saved Goal rather than the field:
          it is Sharpening's (§7.10) and is never typed.

          Deliberately NOT a live region. It was one, and on Android that meant the whole
          sentence was announced on every keystroke in the unit field — "1 b · the button
          will say Did it", "1 bo · …". The text sits directly under the controls that
          change it and is read on focus like any other label. */}
      <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
        {stepperHint(
          target,
          unit.trim() === '' ? null : unit,
          existing?.unit_canonical ?? null,
        )}
      </Text>

      {/* §4.2, "Sharpen it". 46pt, and below the fields rather than beside them: it acts
          on what is written above it, so it reads down. Absent once a suggestion has
          been given — one sharpen per Goal, no reroll. */}
      {headUnknown ? (
        <Text style={{ ...styles.label, color: color.ink2, marginTop: space.lg }}>
          Sharpening isn&rsquo;t available just now. Your goal saves as normal.
        </Text>
      ) : null}

      {canSharpen ? (
        // `<Button variant="outlined">` is exactly what this was hand-rolling: the same
        // `paperRaised` inside a hairline, the same press opacity, the same 17pt/700. The
        // only thing it needed was §4.1's 46pt, which is a `height` now rather than a
        // fifth variant.
        //
        // The accessible label is the visible one, which is why it is not passed: it moves
        // with the text rather than staying fixed at "Sharpen it". A label saying one
        // thing while the button says another is §6 A1's exact failure, and it was also
        // the only signal a screen-reader Member had that the call had started.
        <Button
          label={sharpen.isPending ? 'Sharpening…' : 'Sharpen it'}
          height={size.controlSharpen}
          accessibilityHint="Suggests a countable version. Your own wording is always kept as an option."
          // Never disabled while the call is out (§4.2, "no disabled control"). Tapping
          // again during a call is harmless: the mutation replaces its own result.
          onPress={() => void askToSharpen()}
          style={{ marginTop: space.lg }}
        />
      ) : null}

      {/* The "Working" pill (§4.2). `ink3`, no overlay, nothing disabled — the Member can
          keep typing, save, or leave while the model thinks. */}
      {sharpen.isPending ? (
        <View
          style={{
            alignSelf: 'center',
            marginTop: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
            borderRadius: radius.pill,
            backgroundColor: color.paperSunk,
          }}
        >
          <Text style={{ ...styles.label, color: color.ink3 }}>Sharpening…</Text>
        </View>
      ) : null}

      {/* The "Answered" state. Two equal cards, nothing pre-selected. */}
      {suggestion === null ? null : (
        <SuggestionCards
          suggestion={suggestion}
          // The snapshot, so this card keeps saying what the Member wrote even after
          // choosing SHARPENED has rewritten the fields above it.
          mine={askedWith ?? mine}
          choice={choice}
          onChoose={choose}
        />
      )}

      {/* `live={false}`: every message here arrives through `say()`, which already calls
          announceForAccessibility — the only one iOS honours. Pairing the two made
          Android say everything twice.

          This is also where the "Refused / slow / malformed" state lands (§4.2): plain
          words in `ink2`, no red, no retry modal, and the Goal already saved. */}
      <Trouble message={trouble} live={false} style={{ marginTop: space.lg }} />

      {/* Never disabled by the Answered state, and never by the pre-save.
          §4.2 is explicit — "Save stays enabled … no overlay, no disabled control" —
          and both gates broke it. Disabling until a card was picked put a dead primary
          control between a Member and their own text, with the cards undismissable; and
          because the pre-save shares this mutation, the working state disabled Save for
          the length of the request it was supposed to stay usable through.

          Unpicked is not ambiguous: `resolved` reads the live fields, which are the
          Member's own words until they choose otherwise. Saving does the obvious thing. */}
      <Button
        label={write.isPending && !presaving ? 'Saving…' : 'Save this goal'}
        variant="primary"
        disabled={(write.isPending && !presaving) || clear.isPending}
        style={{ marginTop: space.xl }}
        onPress={() => void save()}
      />

      {/* A failure does not spend the sharpen (§4.2), so offering it again is honest —
          and refusing to would be the dead end §7.9 rules out. Only after a failure:
          there is no reroll on a suggestion that arrived. */}
      {sharpenFailed && !sharpen.isPending ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try sharpening again"
          onPress={() => void askToSharpen()}
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
            setConfirming({
              title: 'Clear this square?',
              body: 'The goal goes; the square stays empty.',
              confirmLabel: 'Clear it',
              cancelLabel: 'Keep it',
              onConfirm: () =>
                clear.mutate(tileId ?? '', {
                  onSuccess: () =>
                    leaveTo({ pathname: '/board/[id]', params: { id: boardId ?? '' } }),
                  onError: () => say('That didn’t clear. Have another go in a moment.'),
                }),
            })
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
        onPress={() => leaveTo({ pathname: '/board/[id]', params: { id: boardId ?? '' } })}
      />
      <ConfirmSheet confirmation={confirming} onClose={() => setConfirming(null)} />

    </FormScreen>
  );
}
