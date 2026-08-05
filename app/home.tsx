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
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Loading } from '../components/Screen';
import { useFamilies } from '../lib/queries/families';
import { usePendingMemberships } from '../lib/queries/invitations';
import { useSession } from '../lib/session';
import { styles } from '../theme/fonts';
import { color, radius, size, space, stroke } from '../theme/tokens';

export default function Home() {
  const session = useSession();
  const router = useRouter();
  const families = useFamilies(session?.user.id);
  const pending = usePendingMemberships(session?.user.id);

  if (session === undefined) return <View style={{ flex: 1, backgroundColor: color.paper }} />;
  if (session === null) return <Redirect href="/" />;

  const list = families.data ?? [];
  const waiting = pending.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop }}
    >
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        {list.length === 0 && waiting.length === 0 ? 'Welcome' : 'Your families'}
      </Text>

      {/* `inline`, because the header above this is already real and stays put — the
          spinner sits in the flow of the page rather than replacing it. */}
      {families.isPending ? (
        <Loading what="Loading your families" inline />
      ) : families.isError ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          Couldn’t reach your families just now. Pull down in a moment.
        </Text>
      ) : list.length === 0 && waiting.length === 0 ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          A Family is the group who’ll see your board. Start one, or join the one you were
          invited to.
        </Text>
      ) : (
        <View style={{ marginTop: space.lg, gap: size.stack }}>
          {/* Opens the roster. The Board is still slice 5; the roster is what a Family has
              to show for itself until then. */}
          {list.map((family) => (
            <Pressable
              key={family.id}
              accessibilityRole="button"
              accessibilityLabel={`${family.name}, as ${family.member.display_name}${
                family.member.role === 'organizer' ? ', organizer' : ''
              }`}
              onPress={() => router.push({ pathname: '/family/[id]', params: { id: family.id } })}
              style={({ pressed }) => ({
                minHeight: size.minTouch,
                padding: space.md,
                backgroundColor: color.paperRaised,
                borderRadius: radius.card,
                borderWidth: stroke.hairline,
                borderColor: color.hairline,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ ...styles.cardHead, color: color.ink }}>{family.name}</Text>
              <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
                {family.member.display_name}
                {family.member.role === 'organizer' ? ' · organizer' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* §3.2 lets them know they asked, and nothing else about the Family. Without this
          a waiting Member sees first-run copy and has no way to learn they are in a queue
          — re-entering the code just says it has been used. */}
      {waiting.length === 0 ? null : (
        <View style={{ marginTop: space.lg, gap: size.stack }}>
          {waiting.map((request) => (
            <View
              key={request.member_id}
              accessible
              accessibilityLabel={`${request.family_name}, waiting to be let in`}
              style={{
                minHeight: size.minTouch,
                padding: space.md,
                borderRadius: radius.card,
                borderWidth: stroke.hairline,
                borderColor: color.hairline,
              }}
            >
              <Text style={{ ...styles.cardHead, color: color.ink2 }}>{request.family_name}</Text>
              <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xs }}>
                waiting to be let in
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
        <Button label="Join a Family" onPress={() => router.push('/family/join')} />
      </View>

      {/* §4.6's Account screen, which now exists — so this points at it rather than
          straight past it at the notifications screen, and the handset's settings sit
          where §4.6 orders them: Families, then the people you look after, then this
          handset. This is still the only screen in the app that is about the Account
          rather than about one Family, which is why the door is here. */}
      <Button
        label="You"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        onPress={() => router.push('/account')}
      />
    </ScrollView>
  );
}
