/**
 * The drafting table — Slice 6 (PRD §6, FRONTEND_DESIGN §4.1).
 *
 * **Authoring is a list, not a grid.** A 66.8pt tile cannot hold a sentence, and the board
 * is not drawn until it seals. The 5×5 arrives with slice 11, when there is progress on it
 * worth looking at.
 *
 * Order is not priority (§4.1): nobody picks where a Goal lands. The rows are listed in
 * position order — see the note above the list for why that is the stable choice and not
 * a contradiction — and the Member is never offered a position to choose.
 *
 * The pips are `ink3` on `paperSunk` and never `moss`. Writing a goal is not growth —
 * reserve the accent for the ladder or the board stops meaning anything (§4.1).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { leaveTo } from '../../lib/leave';
import { Board } from '../../components/Board';
import { Button } from '../../components/Button';
import { useBoard, useBoardHead, useTileCounts } from '../../lib/queries/boards';
import { useSession } from '../../lib/session';
import { isTileComplete } from '../../src/domain/growth';
import { completedLines } from '../../src/domain/lines';
import { AUTHORABLE_TILES, CENTER_POSITION, draftProgress, remainingCopy, targetSummary } from '../../src/domain/goal';
import { sealCopy } from '../../src/domain/year';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

export default function DraftingTable() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const head = useBoardHead(id, session?.user.id);
  const board = useBoard(id);
  const counts = useTileCounts((board.data ?? []).map((t) => t.id));

  if (head.isPending || board.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator
          color={color.ink3}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading the board"
        />
      </View>
    );
  }

  // `board.isError` matters as much as `head`'s. Without it a failed Tiles read after
  // `retry: 2` leaves `tiles = []` and the screen states four confident falsehoods —
  // "0 of 24", an empty pip strip, "Nothing written yet.", and a disabled button reading
  // "All twenty-four written" directly above "24 still empty."
  if (head.data === null || head.data === undefined || board.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, paddingTop: size.screenTop }}>
        <Text style={{ ...styles.body, color: color.ink2 }}>
          Couldn&rsquo;t open that board just now. Try again in a moment.
        </Text>
        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
          onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: head.data?.familyId ?? '' } })}
        />
      </View>
    );
  }

  const tiles = board.data ?? [];
  const centre = tiles.find((t) => t.position === CENTER_POSITION);
  const authorable = tiles.filter((t) => t.position !== CENTER_POSITION);
  const written = authorable.filter((t) => t.goal !== null);
  const firstEmpty = authorable.find((t) => t.goal === null);
  const sealed = head.data.sealedAt !== null;

  // Exactly the two conditions `write_goal()` gates on, and no third.
  //
  // This read `year.status === 'setup'` first, which is a rule the server does not have
  // and which locked out the case it exists to serve. §21.1's late joiner is approved
  // into a Year that is already `active`; the trigger in migration 28 deals them an
  // UNSEALED Board with a `personal_setup_deadline` seven days out. Under the old gate
  // that Member opened their drafting table, found every row dead and no "Write another",
  // and could not write one Goal in the whole window — while the server would have
  // accepted every one of them.
  //
  // `controlled` is the other half. `boards_read` is Family-wide, so this route opens on
  // anyone's Board; without it a sibling's Board renders full write affordances that
  // `write_goal()` answers with 42501.
  const canWrite = head.data.controlled && !sealed && head.data.year.status !== 'frozen';

  // A late joiner's window is their own, not the Year's (§21.1). Feeding the Year's
  // long-past deadline to sealCopy() told them "the board has sealed" while the footer
  // said "24 still empty" — two lines of the same screen contradicting each other.
  const deadline =
    head.data.joinedLateAt !== null && head.data.personalSetupDeadline !== null
      ? head.data.personalSetupDeadline
      : head.data.year.setupDeadline;

  const title = head.data.isSelf ? 'Your goals' : `${head.data.memberName}’s goals`;

  /**
   * Sealed Boards are drawn; drafts are listed.
   *
   * §4.1: "Authoring is a list, not a grid — a 66.8pt tile cannot hold a sentence, and
   * the board isn't drawn until it seals." So the same route is two screens, and which
   * one you get is a fact about the Board rather than a navigation choice. Sealing is
   * the moment twenty-four sentences become a board.
   */
  if (sealed) {
    const tileCounts = counts.data ?? {};
    const boardTiles = tiles.map((t) => ({
      id: t.id,
      position: t.position,
      goal:
        t.goal !== null
          ? { text: t.goal.text, target: t.goal.target, unit: t.goal.unit }
          : t.familyGoalText !== null
            ? // The shared Centre is a Goal like any other once it is decided — one row
              // referenced by every Board, completed for everyone at once (§12.3).
              // Target 1: it is done when the Family says it is.
              { text: t.familyGoalText, target: 1, unit: null }
            : null,
      count: tileCounts[t.id] ?? 0,
    }));

    // Derived here, on every render, from the counts already in hand — §13.1's Lines are
    // never stored, and `milestones` records that a Line was *reached* rather than which
    // Lines stand. Passing `[]` until slice 13 would have drawn twelve empty pips beneath
    // a board with a finished row on it.
    const lines = completedLines(
      new Set(
        boardTiles
          .filter((t) => t.goal !== null && isTileComplete(t.count, t.goal.target))
          .map((t) => t.position),
      ),
    );

    return (
      // The Board is pinned and whatever sits under it scrolls (§3): it never scrolls,
      // never shrinks, never paginates. Header and board are outside the ScrollView; only
      // the footer is inside it, which is what gives an SE somewhere to put the overflow.
      <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: size.screenTop }}>
        <View style={{ paddingHorizontal: space.xl }}>
          <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
            {title}
          </Text>
          <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
            {head.data.year.calendarYear}
          </Text>
        </View>

        <View style={{ marginTop: space.lg }}>
          <Board
            tiles={boardTiles}
            centreMode={head.data.year.centerMode}
            completedLines={lines}
            // Logging is slice 11 and the tile sheet is where it lives (§3) — a mis-tap
            // on a 67pt target in a pocket must never write a row. Until that exists,
            // tapping a square does nothing rather than doing something surprising.
            onPressTile={() => undefined}
          />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
          <Text
            style={{
              ...styles.label,
              color: color.ink3,
              marginTop: space.lg,
              textAlign: 'center',
            }}
          >
            This board has sealed. Changing a goal now costs a swap.
          </Text>

          <Button
            label="Back"
            variant="text"
            style={{ marginTop: space.xl, marginHorizontal: space.xl, alignItems: 'flex-start' }}
            onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: head.data?.familyId ?? '' } })}
          />
        </ScrollView>
      </View>
    );
  }
  // Hoisted out of head.data because the narrowing above does not survive into a closure.
  const centreRoute = { yearId: head.data.year.id, familyId: head.data.familyId };

  const compose = (tileId: string) =>
    router.push({ pathname: '/board/goal', params: { boardId: id ?? '', tileId } });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop, paddingBottom: space.xxl }}
    >
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        {title}
      </Text>

      {/* §4.1's meta line. Factual and never conditional (§4.5): a count and a date, with
          nothing that could read as a scold (§0.3). */}
      <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
        {draftProgress(written.length)}
        {' · '}
        {sealed ? 'the board has sealed' : sealCopy(new Date(), new Date(deadline), head.data.timezone)}
      </Text>

      {/* The 24-pip strip. One pip per authorable Tile, ink3 when written and hairline
          when not — never moss (§4.1). Decorative: the count above already says it, and
          24 separate elements in the accessibility tree would say it 24 more times. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: space.xs,
          marginTop: space.lg,
          padding: space.md,
          backgroundColor: color.paperSunk,
          borderRadius: radius.card,
        }}
      >
        {Array.from({ length: AUTHORABLE_TILES }, (_, i) => (
          <View
            key={i}
            style={{
              width: size.dot,
              height: size.dot,
              borderRadius: radius.pill,
              backgroundColor: i < written.length ? color.ink3 : color.hairline,
            }}
          />
        ))}
      </View>

      {/* The Centre, in clay because clay means family and nothing else (§1.1). Not
          authored here (§6.5) — it is the Centre Vote's, and that is slices 8 and 9. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`The centre: ${
          centre?.familyGoalText ?? centre?.goal?.text ?? 'your family decides this one together'
        }`}
        accessibilityHint="Opens the family vote for the middle square"
        onPress={() =>
          router.push({
            pathname: '/year/centre',
            params: centreRoute,
          })
        }
        style={({ pressed }) => ({
          marginTop: space.lg,
          padding: space.md,
          minHeight: size.minTouch,
          backgroundColor: color.clayTint,
          borderRadius: radius.card,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ ...styles.label, color: color.clayDeep }}>The centre</Text>
        <Text style={{ ...styles.body, color: color.ink, marginTop: space.xs }}>
          {centre?.familyGoalText ??
            centre?.goal?.text ??
            'Your family decides this one together.'}
        </Text>
      </Pressable>

      {/* Position order, which in practice IS write order: "Write another" always fills
          the lowest empty position, so the two agree unless a square is cleared and
          rewritten. `created_at` lives on the Goal rather than the Tile and would cost a
          second sort key for that one case.

          What matters is that the order is stable — a list that reshuffles under a Member
          as they write is a list they cannot find anything in — and that nobody is ever
          offered a position to choose, which is what §4.1's "order is not priority"
          protects. */}
      <View style={{ marginTop: space.xl }}>
        {written.map((tile, i) => (
          <Pressable
            key={tile.id}
            disabled={!canWrite}
            accessibilityRole="button"
            accessibilityLabel={`Goal ${i + 1}: ${tile.goal?.text ?? ''}, ${targetSummary(
              tile.goal?.target ?? 1,
              tile.goal?.unit ?? null,
            )}`}
            accessibilityHint={canWrite ? 'Opens this goal to edit it' : undefined}
            // Without this a sealed Board's goals are still announced as buttons, so a
            // screen-reader Member is invited to tap something that does nothing (§6 A1).
            accessibilityState={{ disabled: !canWrite }}
            onPress={() => compose(tile.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: space.md,
              paddingVertical: space.md,
              borderTopWidth: 1,
              borderTopColor: color.hairline,
              minHeight: size.minTouch,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...styles.index, color: color.ink3 }}>
              {String(i + 1).padStart(2, '0')}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ ...styles.body, color: color.ink }}>{tile.goal?.text}</Text>
              <Text style={{ ...styles.meta, color: color.ink2, marginTop: space.xs }}>
                {targetSummary(tile.goal?.target ?? 1, tile.goal?.unit ?? null)}
                {/* Display only (§6.3). Nothing branches on it, here or anywhere. */}
                {tile.goal?.pace_hint === null || tile.goal?.pace_hint === undefined
                  ? ''
                  : ` · ${tile.goal.pace_hint}`}
              </Text>
            </View>
          </Pressable>
        ))}

        {written.length === 0 ? (
          <Text style={{ ...styles.body, color: color.ink2 }}>
            Nothing written yet. Twenty-four squares, one goal each — in any order you like.
          </Text>
        ) : null}
      </View>

      {/* §4.1's pinned bar, as a footer rather than a floating one: the list is short
          enough to reach the end of, and a pinned bar over a keyboard-adjacent screen
          costs more than it gives.

          "Seal the board" is deliberately NOT a control. seal_year() refuses before the
          Setup Window closes — an Organizer who could seal early would be taking authoring
          time from everyone else, silently — so a button here would be a button to an
          error. What is left is the true thing: how many squares are still empty, and
          when the date will decide it. An unfinished Board seals with empty Tiles and that
          is a legitimate outcome (§10.2), so this states a fact and asks for nothing. */}
      {canWrite ? (
        <Button
          label={firstEmpty === undefined ? 'All twenty-four written' : 'Write another'}
          variant="primary"
          disabled={firstEmpty === undefined}
          style={{ marginTop: space.xl }}
          onPress={() => {
            if (firstEmpty !== undefined) compose(firstEmpty.id);
          }}
        />
      ) : null}

      <Text style={{ ...styles.label, color: color.ink3, marginTop: space.md, textAlign: 'center' }}>
        {/* True as written, and narrower than it looks: §9.5's free write after sealing
            applies only to an EMPTY personal Centre, and *changing* a Goal costs a Swap
            even inside that window. Offering the Centre write is slice 9's client half. */}
        {sealed
          ? 'This board has sealed. Changing a goal now costs a swap.'
          : !head.data.controlled
            ? `${head.data.memberName}’s to write.`
            : remainingCopy(written.length)}
      </Text>

      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: head.data?.familyId ?? '' } })}
      />
    </ScrollView>
  );
}
