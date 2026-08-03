/**
 * Where a signed-in Account lands. Slice 2 turns this into "Create a Family / Join a
 * Family" (FRONTEND_DESIGN §4, "Home (no Family)"); for now it proves the session round
 * trip and gives sign-out somewhere to live.
 */

import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '../components/Button';
import { signOut } from '../lib/auth';
import { useSession } from '../lib/session';
import { text } from '../theme/fonts';
import { color, space, type } from '../theme/tokens';

export default function Home() {
  const session = useSession();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, justifyContent: 'center' }}>
      <Text style={{ ...text(type.title), color: color.ink }}>You&rsquo;re in</Text>
      <Text style={{ ...text(type.body), color: color.ink2, marginTop: space.sm }}>
        {session?.user.email ?? 'Signed in'}
      </Text>
      <Button
        label="Sign out"
        variant="text"
        style={{ marginTop: space.lg, alignItems: 'flex-start' }}
        onPress={() =>
          void signOut().then(() => router.replace('/'))
        }
      />
    </View>
  );
}
