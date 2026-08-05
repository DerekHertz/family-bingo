/**
 * Composing the replacement — Slice 18 (PRD §18, FRONTEND_DESIGN §4.4).
 *
 * §4.4 is "one confirm sheet, then compose", and this is the compose half. The sheet lives
 * on the Board screen because that is where the live glyph and count are; by the time a
 * Member arrives here they have already been told what happens to their Increments and
 * seen how many swaps they have left.
 *
 * **Its own route rather than a mode of `/board/goal`.** Not duplication: the two screens
 * are genuinely different, because Sharpening does not apply here. `swap_tile()` writes
 * only `text` and `target` and leaves `unit`, `unit_canonical`, `category` and `pace_hint`
 * from the old Goal in place — there is no server path to write a new unit — so offering
 * "Sharpen it" would offer a suggestion nothing could save. §4.2's one-sharpen-per-Goal
 * rule belongs to authoring.
 *
 * **Raising a Target is free and this screen says so before the tap** (§18.3). Making a
 * Goal harder needs no policing, and a Member who bumps 100 to 120 should not be told it
 * cost them one of three. `evaluateGoalRewrite()` is the tested rule and `swap_tile()`
 * applies the same one server-side.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { leaveTo } from '../../lib/leave';
import { useBoard, useBoardHead, useTileCounts } from '../../lib/queries/boards';
import { swapFailureCopy, useSwapBudget, useSwapTile } from '../../lib/queries/swaps';
import { useSession } from '../../lib/session';
import { GOAL_TEXT, targetSummary } from '../../src/domain/goal';
import { evaluateGoalRewrite, swapRefusalCopy } from '../../src/domain/swaps';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

export default function ComposeSwap() {
  const { boardId, tileId } = useLocalSearchParams<{ boardId: string; tileId: string }>();
  const router = useRouter();
  const session = useSession();
  const head = useBoardHead(boardId, session?.user.id);
  const board = useBoard(boardId, session?.user.id);
  const tileIds = (board.data ?? []).map((t) => t.id);
  const counts = useTileCounts(tileIds, session?.user.id);
  const budget = useSwapBudget(boardId, session?.user.id);
  const swap = useSwapTile(boardId ?? '');

  const tile = (board.data ?? []).find((t) => t.id === tileId) ?? null;
  const before = tile?.goal ?? null;

  // Seeded from the Goal being replaced. The Member is *rewriting*, not writing: starting
  // from a blank field would make them retype a sentence they mostly want to keep.
  //
  // **Not a `useState` initialiser.** That runs on the first render, when `board.data` is
  // still `undefined` — so the field would have been empty forever, and the whole screen
  // would have looked like it had lost the Goal it is about. Seeded once, when the data
  // arrives, and keyed on the Tile so navigating to a different square re-seeds; after
  // that a refetch cannot overwrite what is being typed.
  const [draft, setDraft] = useState<{ tileId: string; text: string; target: number } | null>(
    null,
  );
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    if (tile === undefined || tile === null) return;
    if (draft !== null && draft.tileId === tile.id) return;
    setDraft({
      tileId: tile.id,
      text: tile.goal?.text ?? '',
      target: tile.goal?.target ?? 1,
    });
  }, [tile, draft]);

  const text = draft?.text ?? '';
  const target = draft?.target ?? 1;
  const setText = (next: string) =>
    setDraft((d) => (d === null ? d : { ...d, text: next }));
  const setTarget = (next: (n: number) => number) =>
    setDraft((d) => (d === null ? d : { ...d, target: next(d.target) }));

  const say = (message: string) => {
    setTrouble(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const count = counts.data?.[tileId ?? ''] ?? 0;
  const decision =
    head.data === undefined || head.data === null
      ? null
      : evaluateGoalRewrite(
          {
            sealed: head.data.sealedAt !== null,
            frozen: head.data.year.status === 'frozen',
            swapsUsed: budget.data ?? 0,
            // The shared Centre is one row on every Board; nobody swaps it alone (§12.3).
            isSharedCenter: tile?.familyGoalText != null,
            isComplete: before !== null && count >= before.target,
          },
          before === null ? null : { text: before.text, target: before.target },
          { text, target },
        );

  const trimmed = text.trim();
  const tooShort = trimmed.length < GOAL_TEXT.min;
  const tooLong = trimmed.length > GOAL_TEXT.max;

  const submit = () => {
    if (decision === null) return;
    if (!decision.allowed) {
      say(swapRefusalCopy(decision.reason));
      return;
    }
    if (tooShort || tooLong) {
      say(`A goal is ${GOAL_TEXT.min} to ${GOAL_TEXT.max} characters.`);
      return;
    }
    setTrouble(null);
    swap.mutate(
      { tileId: tileId ?? '', text: trimmed, target },
      {
        onSuccess: () =>
          leaveTo({ pathname: '/board/[id]', params: { id: boardId ?? '' } }),
        onError: (e) => say(swapFailureCopy(e)),
      },
    );
  };

  // Nothing is rendered against data that has not arrived. Without this the screen shows
  // an empty field, a target of 1 and a cost preview built from a budget of 0 — four
  // confident falsehoods about the Goal a Member is deciding whether to set down.
  if (head.isPending || board.isPending || counts.isLoading || budget.isPending) {
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

  // A square this route cannot act on. Reachable by a deep link, by a stale cache, or by
  // a Board that sealed or froze between the confirm sheet and this screen — and §0.3
  // says to state the reason rather than offer a retry that cannot work.
  if (head.data === null || head.data === undefined || tile === null || decision === null) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, paddingTop: size.screenTop }}>
        <Text style={{ ...styles.body, color: color.ink2 }}>
          Couldn’t open that square just now. Try again in a moment.
        </Text>
        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
          onPress={() => leaveTo({ pathname: '/board/[id]', params: { id: boardId ?? '' } })}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop }}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
          {before === null ? 'Write a goal' : 'The new goal'}
        </Text>

        {/* What they are setting down, if anything. §7.10: never phrased as giving up. */}
        {before === null ? null : (
          <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
            Replacing “{before.text}”
          </Text>
        )}

        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Walk the dog every day"
          placeholderTextColor={color.ink3}
          maxLength={GOAL_TEXT.max}
          accessibilityLabel="The new goal"
          style={{
            ...styles.compose,
            minHeight: 96,
            marginTop: space.xl,
            padding: space.md,
            color: color.ink,
            backgroundColor: color.paperRaised,
            borderWidth: 1,
            borderColor: color.hairline,
            borderRadius: radius.card,
            textAlignVertical: 'top',
          }}
        />

        {/* The target stepper. Every saved Goal has a Target — `stageOf` is meaningless
            without one (§4.1) — so there is no "no target" option and the floor is 1. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            marginTop: space.lg,
          }}
        >
          <Stepper
            label="One fewer"
            symbol="−"
            onPress={() => setTarget((n) => Math.max(1, n - 1))}
          />
          <Text
            accessibilityLiveRegion="polite"
            style={{ ...styles.ringCount, color: color.ink, minWidth: 56, textAlign: 'center' }}
          >
            {target}
          </Text>
          <Stepper label="One more" symbol="+" onPress={() => setTarget((n) => n + 1)} />
          <Text style={{ ...styles.body, color: color.ink2, flex: 1 }}>
            {targetSummary(target, before?.unit ?? null)}
          </Text>
        </View>

        {/* §18.3 said before the tap, not after it. A Member raising 100 to 120 is making
            the Goal harder, which needs no policing and costs nothing — and being told
            afterwards that it was free is not the same as knowing beforehand. */}
        {decision === null ? null : !decision.allowed ? (
          <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>
            {swapRefusalCopy(decision.reason)}
          </Text>
        ) : (
          <Text style={{ ...styles.body, color: color.ink2, marginTop: space.lg }}>
            {decision.cost === 'swap'
              ? `This costs a swap. ${
                  decision.swapsRemainingAfter === 1
                    ? 'One left after it.'
                    : `${decision.swapsRemainingAfter} left after it.`
                }`
              : decision.cost === 'free'
                ? 'Raising a target is free — making a goal harder needs no policing.'
                : 'Nothing has changed yet.'}
          </Text>
        )}

        {trouble === null ? null : (
          <Text
            accessibilityLiveRegion="polite"
            style={{ ...styles.body, color: color.ink2, marginTop: space.md }}
          >
            {trouble}
          </Text>
        )}

        <Button
          label={swap.isPending ? 'Saving…' : 'Save this goal'}
          variant="primary"
          disabled={
            swap.isPending ||
            tooShort ||
            tooLong ||
            decision === null ||
            !decision.allowed ||
            decision.cost === 'none'
          }
          style={{ marginTop: space.xl }}
          onPress={submit}
        />

        <Button
          label="Keep the old one"
          variant="text"
          style={{ marginTop: space.md, alignItems: 'flex-start' }}
          onPress={() =>
            leaveTo({ pathname: '/board/[id]', params: { id: boardId ?? '' } })
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** One end of the target stepper. 44pt minimum, like everything a finger lands on (§6 A3). */
function Stepper({
  label,
  symbol,
  onPress,
}: {
  label: string;
  symbol: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size.minTouch,
        height: size.minTouch,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: color.hairline,
        borderRadius: radius.card,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ ...styles.action, color: color.ink }}>{symbol}</Text>
    </Pressable>
  );
}
