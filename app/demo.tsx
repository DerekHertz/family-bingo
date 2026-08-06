/**
 * The door into the demo, and the only screen that knows there is one.
 *
 * A route rather than a button handler on the landing page, for the same reason
 * `app/auth/callback.tsx` is a route: the work is asynchronous, it can fail, and the thing
 * that comes back is a session — so it needs somewhere to wait, somewhere to say what went
 * wrong, and an address that survives a reload. `/demo` is also linkable, which is worth
 * more than it sounds for a page whose whole job is to be pasted somewhere.
 *
 * What it is *not* is a second sign-in screen. There is nothing to choose here: the Edge
 * Function reads no parameters and `signInAsDemo()` takes none, so this screen has one
 * outcome and two ways of failing.
 */

import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Loading } from '../components/Screen';
import { DemoUnavailable, signInAsDemo, useIsDemo } from '../lib/demo';
import { useFamilies } from '../lib/queries/families';
import { useSession } from '../lib/session';
import { styles } from '../theme/fonts';
import { color, size, space } from '../theme/tokens';

export default function EnterTheDemo() {
  const session = useSession();
  const isDemo = useIsDemo();
  const router = useRouter();
  const [failed, setFailed] = useState<'busy' | 'unavailable' | null>(null);

  /**
   * The request is fired once per mount and never again.
   *
   * A ref rather than a state flag: setting state would re-render, and the effect's own
   * dependencies change as the session arrives — so a guard that lived in the render would
   * be read before it was written and the door would be knocked on twice. Two knocks is not
   * merely wasteful here; it spends two of five attempts against the rate limiter.
   */
  const asked = useRef(false);

  useEffect(() => {
    // `undefined` is the keychain still being read. Asking for a demo session while an
    // existing one is being restored would replace a real Member's session with the demo's.
    if (session === undefined || isDemo || asked.current) return;
    asked.current = true;
    void signInAsDemo().catch((thrown) => {
      setFailed(thrown instanceof DemoUnavailable ? thrown.reason : 'unavailable');
    });
  }, [session, isDemo]);

  /**
   * Where the demo starts.
   *
   * The Family screen, not the Board and not `/home`. `/home` is a list with one card on it
   * — a tap that asks nothing and answers nothing — and the Board is one of the four things
   * worth seeing rather than the way to the other three. The Family screen is the hub: the
   * roster, the Board, "What's happened", and the Wrapped button all leave from it.
   *
   * One query, and it is the one the app already uses for exactly this. Chaining on to the
   * Year and the Board to deep-link past it would be three reads to save a tap, and would
   * duplicate the Year selection that `app/family/[id].tsx` does properly.
   */
  const families = useFamilies(isDemo ? session?.user.id : undefined);
  const only = families.data?.length === 1 ? families.data[0] : undefined;

  if (failed !== null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: color.paper,
          padding: space.xl,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Plain words in `ink2`, no colour and no "error" — §1.1 and §0.3. Nobody reading
            this did anything wrong; the demo is a shared thing and shared things are
            sometimes busy. */}
        <Text
          style={{
            ...styles.body,
            color: color.ink2,
            textAlign: 'center',
            maxWidth: size.proseWidth,
          }}
        >
          {failed === 'busy'
            ? 'A few people are looking at the demo right now. Try again in a few minutes.'
            : 'The demo isn’t answering just now. Try again in a moment.'}
        </Text>
        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.lg }}
          onPress={() => router.replace('/')}
        />
      </View>
    );
  }

  // A Member who was already signed in as themselves is sent to their own Families rather
  // than being signed out of their Account to look at somebody else's. Nothing on this
  // route is worth that.
  if (session != null && !isDemo) return <Redirect href="/home" />;

  if (only !== undefined) {
    return <Redirect href={{ pathname: '/family/[id]', params: { id: only.id } }} />;
  }

  // No Family, or more than one: `/home` is right for both. The first means the demo has
  // not been seeded on this project and the empty state says so honestly; the second means
  // there is a choice to make, and this screen is not the place to make it.
  if (families.isSuccess) return <Redirect href="/home" />;

  return <Loading what="Opening the demo" />;
}
