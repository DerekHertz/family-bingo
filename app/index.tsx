/**
 * Placeholder. Slice 1's sign-in screen (FRONTEND_DESIGN §4, "Sign in") replaces this.
 *
 * It exists so the scaffold runs and so `expo-router` has a route to resolve; it renders
 * the palette's own ground and nothing that would have to be unpicked later.
 */

import { Text, View } from 'react-native';
import { color, space, type } from '../theme/tokens';

export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.paper,
        padding: space.lg,
      }}
    >
      <Text style={{ ...type.body, color: color.ink2, textAlign: 'center' }}>
        Family Bingo
      </Text>
    </View>
  );
}
