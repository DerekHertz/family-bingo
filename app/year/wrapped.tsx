/**
 * Wrapped — Slice 20's client half (PRD §20, FRONTEND_DESIGN §4 "Wrapped", §3).
 *
 * > Horizontal pager, one card per screen, no chrome except the rail. Generated once at
 * > freeze and materialised (§20.2) — the client reads a single row and renders instantly.
 *
 * That single row is why this screen has no spinner worth speaking of and no derivation at
 * all: `lib/queries/wrapped.ts` reads three tables in one round trip and
 * `src/domain/wrapped.ts` turns them into the deck. Nothing here computes a statistic,
 * nothing here computes an Award, and nothing here sorts a Member — `assignAwards()` belongs
 * to the `wrap` Edge Function and must never gain a second caller.
 *
 * A `FlatList` rather than a pager dependency (§7.5, and the same instinct that keeps the
 * board out of SVG): `pagingEnabled` plus a card exactly one screen wide is the whole
 * feature, and an added dependency for it would be a dependency in the Expo Go bundle for
 * the rest of the app's life.
 *
 * Params follow `app/year/centre.tsx` — `yearId` and `familyId`, because every screen past
 * the Family switcher is scoped to exactly one Family and exactly one Year, and the Year
 * alone cannot answer "who is the Organizer here".
 */

import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Share,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Button } from '../../components/Button';
import { WrappedCard } from '../../components/WrappedCard';
import { failure } from '../../lib/failure';
import { leaveTo } from '../../lib/leave';
import { useFamilies } from '../../lib/queries/families';
import { useRoster } from '../../lib/queries/invitations';
import { useWrapped } from '../../lib/queries/wrapped';
import { useOpenYear, useYears } from '../../lib/queries/years';
import { useSession } from '../../lib/session';
import { currentYearIn } from '../../src/domain/year';
import {
  wrappedDeck,
  type NextYearState,
  type WrappedCardModel,
} from '../../src/domain/wrapped';
import { styles } from '../../theme/fonts';
import { color, size, space } from '../../theme/tokens';

export default function Wrapped() {
  const { yearId, familyId } = useLocalSearchParams<{ yearId: string; familyId: string }>();
  const session = useSession();
  const wrapped = useWrapped(yearId, session?.user.id);
  const families = useFamilies(session?.user.id);
  const roster = useRoster(familyId);
  const years = useYears(familyId);
  const openYear = useOpenYear(familyId ?? '');
  const { width } = useWindowDimensions();
  const [trouble, setTrouble] = useState<string | null>(null);

  const family = families.data?.find((f) => f.id === familyId);
  const year = years.data?.find((y) => y.id === yearId);

  if (wrapped.isPending || families.isPending || roster.isPending || years.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your year"
        />
      </View>
    );
  }

  // Two different absences, and only one of them is a failure. A Year that has not frozen
  // yet simply has no `wrapped` row — `freeze_due_years()` runs hourly and builds it at
  // midnight on 31 December in the Family's own timezone (§20.1, §8.3 T1) — so this is the
  // ordinary state of every Year until then, and saying "something went wrong" about it
  // would be a lie told twelve months a year.
  if (wrapped.isError || wrapped.data === null || year === undefined) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: color.paper,
          padding: space.xl,
          paddingTop: size.screenTop,
        }}
      >
        <Text style={{ ...styles.body, color: color.ink2 }}>
          {wrapped.isError
            ? 'Couldn’t load this year just now. Try again in a moment.'
            : 'This year hasn’t finished yet. Wrapped arrives when it does.'}
        </Text>
        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
          onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: familyId ?? '' } })}
        />
      </View>
    );
  }

  const timezone = family?.timezone ?? 'UTC';
  const nextYear = wrapped.data.family.nextYear;
  const isOrganizer = family?.member.role === 'organizer';
  const alreadyOpen =
    nextYear !== null && (years.data ?? []).some((y) => y.calendar_year === nextYear);

  /**
   * Whether the final card may offer its button — decided from the same three facts
   * `open_year()` checks, in the same order it checks them.
   *
   * It refuses a non-Organizer with 42501, a Year the Family already has with PT409, and a
   * `calendar_year` below the current one in the Family's timezone with 22023. The third is
   * not hypothetical here: §20.10 keeps a frozen Year browsable forever, so a Member reading
   * their 2027 Wrapped in 2031 would otherwise be shown a button to open 2028.
   *
   * `hasOpenSetupWindow` is deliberately *not* consulted, unlike the Family screen's own
   * "Open a Year" button. That gate exists because that button offers "the next free year"
   * and two open windows leave a Family authoring two Boards with nothing on screen to say
   * which is which. This card offers one specific Year, named by `family_cards.next_year`,
   * so the ambiguity cannot arise.
   */
  const nextYearState: NextYearState =
    nextYear === null
      ? 'not-yours'
      : nextYear < currentYearIn(new Date(), timezone)
        ? 'past'
        : alreadyOpen
          ? 'already-open'
          : isOrganizer
            ? 'openable'
            : 'not-yours';

  // The caller's own Member, and only theirs. A Guardian may see a Managed Member's card
  // through `visible_member_ids()`, but "your year" means the person holding the phone —
  // and §20.9's Share button exports whatever card it is sitting on, so a screen that
  // silently swapped in a child's stats would be a one-tap export of a child's data.
  const myMemberId = family?.member.id;
  const mine =
    myMemberId === undefined
      ? null
      : (wrapped.data.memberCards.find((c) => c.memberId === myMemberId)?.stats ?? null);

  // Memoised, and §20.2 is why: Wrapped "is read many times, changes never, and must
  // render instantly". The deck is not cheap — it walks every Milestone of the Year, a
  // list `..._029` §6 deliberately stopped filtering — and a fresh array on every render
  // also changes `FlatList`'s `data` identity and defeats `<WrappedCard>`'s `memo`, so
  // every card remounts whenever anything on this screen changes state.
  // Narrowed once, outside the callback: TypeScript cannot carry a narrowing of
  // `wrapped.data` into a closure, and re-reading it inside would be a second read that
  // could in principle answer differently.
  const payload = wrapped.data;
  const deck = useMemo(() => wrappedDeck({
    member: mine,
    family: payload.family,
    awards: payload.awards,
    // Join order, and nothing else, is what orders the Awards (§7.2). `useRoster` already
    // returns Members by `joined_at` and says so — "the moment it sorts by activity it
    // becomes a ladder".
    roster: (roster.data?.members ?? []).map((m) => ({
      id: m.id,
      name: m.display_name,
      isManaged: m.is_managed,
    })),
    calendarYear: year.calendar_year,
    timezone,
    nextYearState,
  }), [mine, payload, roster.data, year.calendar_year, timezone, nextYearState]);

  const say = (message: string) => {
    setTrouble(message);
    // accessibilityLiveRegion is Android-only; iOS has to be told outright.
    AccessibilityInfo.announceForAccessibility(message);
  };

  const renderCard = ({ item, index }: { item: WrappedCardModel; index: number }) => (
    <WrappedCard
      card={item}
      index={index}
      total={deck.length}
      width={width}
      onShare={
        item.kind === 'personal'
          ? () => {
              // §20.9 — the Member's own card, stats only. The string was built in the
              // domain and is tested there for exactly what it must not contain.
              void Share.share({ message: item.share });
            }
          : undefined
      }
      onOpenNextYear={
        item.kind === 'final' && item.action !== null
          ? ((calendarYear: number) => () => {
              openYear.mutate(calendarYear, {
                onSuccess: () => setTrouble(null),
                // PostgREST rejects with a plain object, so `instanceof Error` reads '' and
                // every branch here would be unreachable — `failure()` is what makes the
                // SQLSTATE readable (see lib/failure.ts).
                onError: (e) => {
                  const { message, code } = failure(e);
                  say(
                    code === '42501' || /organizer/i.test(message)
                      ? 'Only the organizer can open a year.'
                      : code === 'PT409' || /already/i.test(message)
                        ? `${calendarYear} is already open.`
                        : code === '22023' || /passed/i.test(message)
                          ? 'That year has already been and gone.'
                          : 'That didn’t open. Have another go in a moment.',
                  );
                },
              });
            })(item.action.year)
          : undefined
      }
      opening={openYear.isPending}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <FlatList
        data={deck}
        keyExtractor={(card) => card.id}
        renderItem={renderCard}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // Every card is exactly one screen wide, so the list can be measured rather than
        // laid out — which is what keeps a swipe landing on a card boundary rather than
        // between two of them on a slow first render.
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      />

      {/* The only chrome, and it earns its place: a horizontal pager swallows iOS's
          swipe-back gesture, and `headerShown` is false for every screen in this app — so
          without this there is no way out of Wrapped but the home button. `leaveTo` rather
          than `router.back()`, because a push notification (§20.3) is a deep link and there
          is no history behind it. */}
      <View style={{ position: 'absolute', left: space.md, bottom: space.md }}>
        <Button
          label="Done"
          variant="text"
          onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: familyId ?? '' } })}
        />
      </View>

      {trouble === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            ...styles.body,
            color: color.ink2,
            position: 'absolute',
            bottom: space.xxl + space.lg,
            paddingHorizontal: space.xl,
          }}
        >
          {trouble}
        </Text>
      )}
    </View>
  );
}
