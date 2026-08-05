/**
 * The four shapes every screen in this app is made of (FRONTEND_DESIGN §4, §6, §0.3).
 *
 * None of them is a layout abstraction for its own sake. Each one existed already, copied
 * between six and eight times, and each copy carried a rule that only *some* of the copies
 * remembered — which is the actual cost of the duplication:
 *
 *   - `<Loading>`   — eight copies differing only in an accessibility label.
 *   - `<Trouble>`   — seven copies, five with a live region and two deliberately without,
 *                     a real Android rule that existed only as a comment on one of them.
 *   - `<ErrorState>`— three copies, two of them byte-identical.
 *   - `<FormScreen>`— six copies of the keyboard-avoiding scroll shell.
 *
 * No colour is introduced here and none may be. §1.1: there is no red in this palette, and
 * nothing that goes wrong is allowed to invent one — trouble is `ink2` and plain words.
 */

import type { ReactNode } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { leaveTo } from '../lib/leave';
import type { Href } from 'expo-router';
import { styles } from '../theme/fonts';
import { color, size, space } from '../theme/tokens';
import { Button } from './Button';

/**
 * Waiting for the one thing this screen is about.
 *
 * `what` is the accessibility label and it is the *only* thing that differed across the
 * eight copies — "Loading the board", "Loading the centre", "Checking whether you are
 * signed in". It is required rather than defaulted, because a spinner with no name is a
 * screen reader saying nothing while the screen says nothing (§6).
 *
 * `ink3` and never `moss`: waiting is not growth, and the accent has to keep meaning one
 * thing (§0.2). No copy beside it either — a spinner that explains itself is a screen
 * apologising for being slow.
 */
export function Loading({
  what,
  inline = false,
}: {
  what: string;
  /**
   * The one copy that was genuinely different, kept rather than flattened.
   *
   * `app/home.tsx` waits for the Families *inside* a page that is already rendered — the
   * header above it is real and stays put — so the indicator sits in the flow, top-left
   * under the title, instead of taking the screen. Everywhere else the spinner IS the
   * screen, because there is nothing else on it yet.
   */
  inline?: boolean;
}) {
  const indicator = (
    <ActivityIndicator
      color={color.ink3}
      accessibilityRole="progressbar"
      accessibilityLabel={what}
      {...(inline ? { style: { marginTop: space.xl, alignSelf: 'flex-start' } } : {})}
    />
  );
  if (inline) return indicator;
  return (
    <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
      {indicator}
    </View>
  );
}

/**
 * One line of plain words about something that did not work.
 *
 * Renders nothing for `null`, so a screen states the sentence once rather than wrapping
 * every use in its own ternary.
 *
 * ## `live`, and why it is a prop
 *
 * `accessibilityLiveRegion` is **Android-only**. On iOS the announcement has to come from
 * `AccessibilityInfo.announceForAccessibility` (`lib/announce.ts`), which is what every
 * screen here uses — and on Android the two together say the same sentence **twice**.
 *
 * So the rule is: a message that arrives through `say()` is already spoken and must not be
 * a live region as well. `app/board/goal.tsx` and `app/year/centre.tsx` found this the hard
 * way and turned theirs off; the other five kept theirs, and are right to, because their
 * message can also arrive without a `say()` behind it.
 *
 * Defaulting to `true` is deliberate: the failure mode of a missing live region is silence
 * on Android for a message nothing else announced, and silence is the worse of the two.
 * Pass `live={false}` wherever `say()` is the only way the message can appear.
 */
export function Trouble({
  message,
  live = true,
  style,
}: {
  message: string | null;
  live?: boolean;
  /**
   * Merged after the base, like `<Button>`'s. The centred screens (`app/index.tsx`,
   * `app/family/join.tsx`) constrain and centre their line; the rest let it run. What the
   * base guarantees is the part §1.1 fixes — `body` in `ink2`, never a colour.
   */
  style?: TextStyle;
}) {
  if (message === null) return null;
  return (
    <Text
      {...(live ? { accessibilityLiveRegion: 'polite' as const } : {})}
      style={{ ...styles.body, color: color.ink2, marginTop: space.md, ...style }}
    >
      {message}
    </Text>
  );
}

/**
 * A screen that could not load the thing it is for, and the way out of it.
 *
 * Distinct from `<Trouble>` on purpose: this is not a line beside a form the Member can
 * still use, it is the whole screen, and the only useful thing on it is the exit. `backTo`
 * is what this screen is *inside of* — see `lib/leave.ts`, and note that `router.back()`
 * cannot be assumed, because any route can be first on web and a magic link is a deep link.
 *
 * States what happened and asks for nothing (§0.3). "Try again in a moment" is the honest
 * end of it — there is no retry button, because a screen that cannot read its own data has
 * nothing to retry *with* that reopening it would not do better.
 */
export function ErrorState({ message, backTo }: { message: string; backTo: Href }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.paper,
        padding: space.xl,
        paddingTop: size.screenTop,
      }}
    >
      <Text style={{ ...styles.body, color: color.ink2 }}>{message}</Text>
      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.lg, alignItems: 'flex-start' }}
        onPress={() => leaveTo(backTo)}
      />
    </View>
  );
}

/**
 * The shell every screen with a keyboard on it uses.
 *
 * Two behaviours, and both were repeated six times:
 *
 *   - **`behavior="padding"` on iOS and `undefined` on Android.** Android's window already
 *     resizes for the keyboard, and setting a behaviour there fights it.
 *   - **`keyboardShouldPersistTaps="handled"`.** Without it the first tap on a button while
 *     the keyboard is up only dismisses the keyboard, so "Save" needs two taps and the
 *     first one looks like it was ignored.
 */
export function FormScreen({
  children,
  centred = false,
  contentStyle,
}: {
  children: ReactNode;
  /**
   * §4's sign-in and join: the mark and the form sit in the middle of the screen rather
   * than under a header, so the content grows to fill and centres itself.
   */
  centred?: boolean;
  /** Merged after the defaults — `app/year/centre.tsx` needs room under a long scroll. */
  contentStyle?: ViewStyle;
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.xl,
          ...(centred
            ? { flexGrow: 1, justifyContent: 'center', alignItems: 'center' }
            : // Clears the status bar without a safe-area hook (`size.screenTop`).
              { paddingTop: size.screenTop }),
          ...contentStyle,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
