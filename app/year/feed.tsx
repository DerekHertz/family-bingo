/**
 * The Feed — Slice 14 (PRD §14, FRONTEND_DESIGN §3 `<FeedRow>` and §4's Feed row).
 *
 * > The Family's running record of everything that has happened this Year — every
 * > Increment, Milestone, Swap, vote outcome and Member arriving. Read when a Member opens
 * > the app; **it never interrupts anyone**. (CONTEXT.md)
 *
 * That last clause is the design. §15 spends the notification budget on Milestones alone
 * because a family of six generates ~3,300 Increments a year, and this screen is where all
 * of them go instead. So it has no badge, no unread count, and nothing that decays: it is
 * a place to look, not a thing that asks to be cleared.
 *
 * One Family and one Year (§14.1). The `feed` view is `security_invoker`, so RLS already
 * decides which rows exist; the two filters in `useFeed` decide which of the caller's
 * Families and Years they are about, which the view cannot know.
 */

import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { FeedRow } from '../../components/FeedRow';
import { leaveTo } from '../../lib/leave';
import { useFamilies } from '../../lib/queries/families';
import { useFeed } from '../../lib/queries/feed';
import { useRoster } from '../../lib/queries/invitations';
import { useYears } from '../../lib/queries/years';
import { useSession } from '../../lib/session';
import { feedRowKey, type FeedEvent } from '../../src/domain/feed';
import { lineName } from '../../src/domain/lines';
import { styles } from '../../theme/fonts';
import { color, size, space } from '../../theme/tokens';

export default function Feed() {
  const { yearId, familyId } = useLocalSearchParams<{ yearId: string; familyId: string }>();
  const session = useSession();
  const feed = useFeed(familyId, yearId, session?.user.id);
  // Names and the Managed dot. The view carries `member_id` and nothing else about a
  // person — deliberately, since a view that repeated `display_name` on every Increment
  // would be answering the same question three thousand times a year.
  const roster = useRoster(familyId);
  const years = useYears(familyId);
  // For the meta line's Family name only. Already in the cache — the screen that linked
  // here fetched it — so this costs nothing on the normal route in, and answers correctly
  // on a cold deep link.
  const families = useFamilies(session?.user.id);

  const year = (years.data ?? []).find((y) => y.id === yearId);
  const family = (families.data ?? []).find((f) => f.id === familyId);
  const members = new Map(
    (roster.data?.members ?? []).map((m) => [m.id, m] as const),
  );

  /**
   * Who did it.
   *
   * A Member removed from the Family keeps their rows — the Feed is a record and §18.4's
   * "never deleted" is the same instinct — so this has to answer for an id the roster no
   * longer holds. "A member" is the honest answer: naming nobody is better than dropping
   * the row, and better than inventing a name.
   */
  const nameOf = (memberId: string | null): string =>
    memberId === null ? '' : (members.get(memberId)?.display_name ?? 'A member');

  const events: FeedEvent[] = (feed.data?.pages ?? []).flatMap((page) => page.events);

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: size.screenTop }}>
      <View style={{ paddingHorizontal: space.xl, paddingBottom: space.md }}>
        <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
          What’s happened
        </Text>
        {/* §4's "`Family · Year` in `label`". Both, because the Feed is scoped to exactly
            one of each (§14.1) and a Member of two Families has two of these screens. */}
        <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
          {[family?.name, year === undefined ? null : String(year.calendar_year)]
            .filter((part) => part !== null && part !== undefined && part !== '')
            .join(' · ')}
        </Text>
      </View>

      {feed.isPending || roster.isPending ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator
            color={color.ink3}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading the feed"
          />
        </View>
      ) : /* `isLoadingError`, not `isError`. On an infinite query `isError` goes true when
            **any** page fails, including a `fetchNextPage` — so three hundred rows a
            Member had already scrolled would vanish and be replaced by one sentence
            because page eleven timed out in a tunnel. `isLoadingError` is true only when
            there is nothing to show. A failed later page is a footer, below.

            `roster.isError` belongs here too: without the roster every row's name falls
            back to "A member", which is a confident wrong answer rather than a missing
            one — the same trap `board.isError` exists to catch on the Board screen. */
        feed.isLoadingError || roster.isError ? (
        <View style={{ paddingHorizontal: space.xl }}>
          <Text style={{ ...styles.body, color: color.ink2 }}>
            Couldn’t reach the feed just now. Try again in a moment.
          </Text>
        </View>
      ) : (
        <FlatList
          data={events}
          // The view's `id` is the source row's id, unique only together with `kind`.
          keyExtractor={feedRowKey}
          renderItem={({ item }) => (
            <FeedRow
              event={item}
              name={nameOf(item.memberId)}
              managed={
                item.memberId === null
                  ? false
                  : (members.get(item.memberId)?.is_managed ?? false)
              }
              lineNameOf={lineName}
            />
          )}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            // Guarded on both, or a fast scroll fires this several times and asks for the
            // same page concurrently.
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          ListEmptyComponent={
            // §0.3: no empty state that implies failure. A quiet Year is a quiet Year.
            <Text
              style={{
                ...styles.body,
                color: color.ink2,
                paddingHorizontal: space.xl,
                marginTop: space.md,
              }}
            >
              Nothing yet this year. It fills up as people log what they’ve done.
            </Text>
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <ActivityIndicator
                color={color.ink3}
                accessibilityRole="progressbar"
                accessibilityLabel="Loading more"
                style={{ marginVertical: space.lg }}
              />
            ) : feed.isFetchNextPageError ? (
              // A page that failed is a footer, never a replacement for the list. Tappable
              // because scrolling to the bottom again would not retry on its own — and
              // `fetchNextPage` is the only recovery, since there is nothing to refresh.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading more again"
                onPress={() => void feed.fetchNextPage()}
                style={({ pressed }) => ({
                  minHeight: size.minTouch,
                  justifyContent: 'center',
                  paddingHorizontal: space.xl,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ ...styles.body, color: color.ink2 }}>
                  Couldn’t load any more just now. Tap to try again.
                </Text>
              </Pressable>
            ) : (
              <View style={{ height: space.xxl }} />
            )
          }
        />
      )}

      <Button
        label="Back"
        variant="text"
        style={{ marginHorizontal: space.xl, marginBottom: space.lg, alignItems: 'flex-start' }}
        onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: familyId ?? '' } })}
      />
    </View>
  );
}
