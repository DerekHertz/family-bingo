/**
 * The permanent marker that says this is the demo.
 *
 * Mounted once in `app/_layout.tsx`, above the `<Stack>` and inside the phone column, so it
 * is on every screen for as long as the demo session lasts. Not a toast, not a dismissible
 * card, not something a screen has to remember to render: a visitor who lands three taps
 * deep in the Feed must be able to see where they are without going back.
 *
 * ## The copy is a fact, not a warning (§0.3)
 *
 * > There is no error colour, no "behind pace", no streak, no empty state that implies
 * > failure.
 *
 * Nothing here has gone wrong and nobody has done anything they should not have, so the
 * strip says what is true — the Year finished, and a finished Year cannot be written to —
 * and stops. No "read-only mode", which sounds like a setting somebody could turn off; no
 * "you cannot…", which is a sentence about the reader. And no colour: `paperSunk` under
 * `ink2`, which is what §1.1 leaves for a plain statement, and the same well the app already
 * sits in behind a tile.
 *
 * ## Why it reads the session rather than asking the server
 *
 * `useIsDemo()` compares the signed-in address to `DEMO_ACCOUNT_EMAIL`, a constant shared
 * with the Edge Function and the seed script. A query would be a round trip whose answer is
 * already in hand and which can fail — and the failure mode is the one thing this component
 * exists to prevent: the marker quietly not rendering while the demo goes on working.
 */

import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { signOut } from '../lib/auth';
import { useIsDemo } from '../lib/demo';
import { styles } from '../theme/fonts';
import { color, size, space, stroke } from '../theme/tokens';

export function DemoBanner() {
  const isDemo = useIsDemo();
  const router = useRouter();

  // Renders nothing at all for everybody else, which is what makes it safe to mount above
  // every screen in the app rather than in the two or three that seemed to need it.
  if (!isDemo) return null;

  return (
    <View
      // One element to a screen reader, and the label reproduces every child — which is the
      // only shape `accessible` is allowed to take (§6, and the handoff's note about
      // collapsing a subtree). Not a live region: it never changes, so announcing it on
      // every navigation would be reading the furniture out loud.
      accessible
      accessibilityRole="summary"
      accessibilityLabel="Demo. A family's finished year. You can read everything here and change nothing."
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        backgroundColor: color.paperSunk,
        borderBottomWidth: stroke.hairline,
        borderBottomColor: color.hairline,
      }}
    >
      <Text style={{ ...styles.meta, color: color.ink2 }}>Demo</Text>
      <Text style={{ ...styles.label, color: color.ink2, flex: 1 }}>
        A family&rsquo;s finished year. Read everything, change nothing.
      </Text>
      {/* Not a `<Button>`: this is a text row in a 34pt strip, and every `<Button>` variant
          is at least 44pt tall by §6 A3's floor — which is the right floor for a control and
          the wrong height for a piece of chrome. The touch target is padded out to the
          strip's full height instead, and the strip is what a finger lands on. */}
      <Text
        accessibilityRole="button"
        accessibilityLabel="Leave the demo"
        onPress={() => {
          // `replace`, not `push`: the demo is not somewhere to come back to, and after the
          // sign-out there is no session for the screen behind this one to read.
          void signOut()
            .catch(() => undefined)
            .finally(() => router.replace('/'));
        }}
        style={{
          ...styles.label,
          color: color.ink,
          paddingVertical: space.xs,
          paddingHorizontal: space.sm,
          minHeight: size.minTouch - space.md,
        }}
      >
        Leave
      </Text>
    </View>
  );
}
