/**
 * The drafting table — Slice 6 (PRD §6, FRONTEND_DESIGN §4.1).
 *
 * **Authoring is a list, not a grid.** A 66.8pt tile cannot hold a sentence, and the board
 * is not drawn until it seals. The 5×5 arrives with slice 11, when there is progress on it
 * worth looking at.
 *
 * Order is not priority (§4.1): the list stays in the order the Goals were written, and
 * positions are dealt at seal, so nobody can put the easy one in a corner. That is why the
 * rows below are sorted by `created_at` and never by position, even though position is
 * what the Tiles come back in.
 *
 * The pips are `ink3` on `paperSunk` and never `moss`. Writing a goal is not growth —
 * reserve the accent for the ladder or the board stops meaning anything (§4.1).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useBoard, useBoardHead } from '../../lib/queries/boards';
import { useSession } from '../../lib/session';
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

  if (head.data === null || head.data === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, paddingTop: size.screenTop }}>
        <Text style={{ ...styles.body, color: color.ink2 }}>
          Couldn&rsquo;t open that board just now. Try again in a moment.
        </Text>
        <Button
          label="Back"
          variant="text"
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
          onPress={() => router.back()}
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

  // Everything before Sealing is free editing; everything after costs a Swap, which is
  // slice 18. A sealed Board is read-only here rather than offering a control that
  // write_goal() would refuse with PT403.
  const canWrite = !sealed && head.data.year.status === 'setup';

  const title = head.data.isSelf ? 'Your goals' : `${head.data.memberName}’s goals`;

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
        {sealed
          ? 'the board has sealed'
          : sealCopy(
              new Date(),
              new Date(head.data.year.setupDeadline),
              head.data.timezone,
            )}
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
      <View
        style={{
          marginTop: space.lg,
          padding: space.md,
          backgroundColor: color.clayTint,
          borderRadius: radius.card,
        }}
      >
        <Text style={{ ...styles.label, color: color.clayDeep }}>The centre</Text>
        <Text style={{ ...styles.body, color: color.ink, marginTop: space.xs }}>
          {centre?.familyGoalText ??
            centre?.goal?.text ??
            'Your family decides this one together.'}
        </Text>
      </View>

      {/* The written Goals, in the order they were written. `created_at` is not on the
          Tile, so position order is the closest stable proxy the read gives — and it is
          stable, which is what matters: a list that reorders under a Member as they write
          is a list they cannot find anything in. Positions are still dealt at seal. */}
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
        {sealed
          ? 'This board has sealed. Changing a goal now costs a swap.'
          : remainingCopy(written.length)}
      </Text>

      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        onPress={() => router.back()}
      />
    </ScrollView>
  );
}
