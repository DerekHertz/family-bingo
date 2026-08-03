/**
 * Home — Slice 2 (PRD §2, FRONTEND_DESIGN §4 "Home (no Family)").
 *
 * With no Family: two options and nothing else. With Families: the list, because §2.2 says
 * an Account may belong to several and every screen past this one is scoped to exactly
 * one.
 *
 * Never sorted by anything but join order (§7.2). The list of Families a person belongs to
 * is not a ranking, and neither is anything else in this app.
 */

import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { signOut } from '../lib/auth';
import { useFamilies } from '../lib/queries/families';
import { useSession } from '../lib/session';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';

export default function Home() {
  const session = useSession();
  const router = useRouter();
  const families = useFamilies(session?.user.id);

  if (session === undefined) return <View style={{ flex: 1, backgroundColor: color.paper }} />;
  if (session === null) return <Redirect href="/" />;

  const list = families.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop }}
    >
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        {list.length === 0 ? 'Welcome' : 'Your families'}
      </Text>

      {families.isPending ? (
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your families"
          style={{ marginTop: space.xl, alignSelf: 'flex-start' }}
        />
      ) : families.isError ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          Couldn’t reach your families just now. Pull down in a moment.
        </Text>
      ) : list.length === 0 ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          A Family is the group who’ll see your board. Start one, or join the one you were
          invited to.
        </Text>
      ) : (
        <View style={{ marginTop: space.lg, gap: size.stack }}>
          {/* Not yet pressable: the Board is slice 5, and a card that navigates nowhere
              is worse than one that plainly does not. §2.2's switcher arrives with it. */}
          {list.map((family) => (
            <View
              key={family.id}
              accessible
              accessibilityLabel={`${family.name}, as ${family.member.display_name}${
                family.member.role === 'organizer' ? ', organizer' : ''
              }`}
              style={{
                minHeight: size.minTouch,
                padding: space.md,
                backgroundColor: color.paperRaised,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: color.hairline,
              }}
            >
              <Text style={{ ...styles.cardHead, color: color.ink }}>{family.name}</Text>
              <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
                {family.member.display_name}
                {family.member.role === 'organizer' ? ' · organizer' : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ marginTop: space.xxl, gap: size.stack }}>
        <Button
          label="Create a Family"
          variant="filled"
          onPress={() => router.push('/family/new')}
        />
        {/* "Join a Family" belongs here per §4, and lands in slice 3 with invitations —
            there is nothing to join until a Family can issue a link. A button that opens
            an empty screen would be worse than its absence. */}
      </View>

      <Button
        label="Sign out"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        onPress={() => void signOut().then(() => router.replace('/'))}
      />
    </ScrollView>
  );
}
