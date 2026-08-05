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
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { celebrate } from '../../lib/celebrate';
import { leaveTo } from '../../lib/leave';
import { Board, type LineCelebration } from '../../components/Board';
import { Button } from '../../components/Button';
import { TileSheet, type SheetTile } from '../../components/TileSheet';
import { useBoard, useBoardHead, useTileCounts } from '../../lib/queries/boards';
import {
  incrementFailureCopy,
  useDeleteIncrement,
  useLogIncrement,
  useRecentIncrements,
} from '../../lib/queries/increments';
import {
  familyGoalFailureCopy,
  useCompleteFamilyGoal,
} from '../../lib/queries/family-goal';
import { useBoardMilestones } from '../../lib/queries/milestones';
import { useRoster } from '../../lib/queries/invitations';
import { useSession } from '../../lib/session';
import {
  announcementFor,
  hapticFor,
  loudest,
  milestoneHeadline,
  newlyCelebrated,
} from '../../src/domain/celebration';
import { completedOn, renderTiles } from '../../src/domain/board';
import { isTileComplete } from '../../src/domain/growth';
import { columnOf, completedLines, lineName, rowOf } from '../../src/domain/lines';
import { longDate } from '../../src/domain/when';
import { AUTHORABLE_TILES, CENTER_POSITION, draftProgress, remainingCopy, targetSummary } from '../../src/domain/goal';
import { sealCopy } from '../../src/domain/year';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

export default function DraftingTable() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const head = useBoardHead(id, session?.user.id);
  const board = useBoard(id, session?.user.id);
  const tileIds = (board.data ?? []).map((t) => t.id);
  const counts = useTileCounts(tileIds, session?.user.id);

  // Which square the sheet is showing. Held as an id rather than the Tile itself, so the
  // sheet re-reads the live count after a tap instead of showing the snapshot it opened
  // with — the ring has to move under the finger or the tap looks lost.
  const [openTileId, setOpenTileId] = useState<string | null>(null);
  const recent = useRecentIncrements(openTileId ?? undefined, session?.user.id);
  const logIncrement = useLogIncrement(tileIds, session?.user.id);
  const deleteIncrement = useDeleteIncrement(tileIds, session?.user.id);
  const completeFamilyGoal = useCompleteFamilyGoal();
  // §4.3's contributors block, and only for the shared Centre. `useRoster` already returns
  // Members in join order, which is the ordering §13.5 permits.
  const roster = useRoster(head.data?.familyId);

  // §5, §12.2, §13.2 — the celebration fires **once per Milestone, ever**, and it is gated
  // on the Milestone rather than on `count >= target`. The count stays true forever once
  // it is true, so anything watching it congratulates a Member every time they reopen a
  // Tile they finished in March, and every time §17.4's queue replays.
  //
  // Scoped to this Member and this Year: `milestones_read` is Family-wide, so an unscoped
  // read would celebrate a sibling's Bingo on this Board.
  const milestones = useBoardMilestones(
    head.data?.memberId,
    head.data?.year.id,
    session?.user.id,
  );
  // Keyed on the Board, not just held. The screen can be reused for a different `id`
  // (`router.replace`, `setParams`), and for one render the new Board's data is
  // `undefined` — so an unkeyed ref survives into it, every Milestone on the new Board
  // reads as fresh, and a Member opening someone else's finished Board is congratulated
  // for all of it.
  const celebrated = useRef<{ boardId: string; seen: Set<string> } | null>(null);
  // §5's Line animation. Held here rather than derived, because it is an *event* — it
  // plays once and then the board is at rest, however many times the screen re-renders.
  const [lineCelebration, setLineCelebration] = useState<LineCelebration | null>(null);

  useEffect(() => {
    const current = milestones.data;
    if (current === undefined) return;
    const boardId = id ?? 'none';
    // The first read of a Board seeds its set and celebrates nothing: opening a Board
    // finished last week must not walk into five celebrations.
    if (celebrated.current === null || celebrated.current.boardId !== boardId) {
      celebrated.current = { boardId, seen: new Set(current.map((m) => m.id)) };
      return;
    }
    const fresh = newlyCelebrated(current, celebrated.current.seen);
    if (fresh.length === 0) return;
    for (const milestone of fresh) celebrated.current.seen.add(milestone.id);

    // One haptic and one sentence however many Milestones landed at once, and they belong
    // to the loudest of them. A tap that closes a Tile, three Lines and the Blackout is a
    // single transaction server-side; five bursts of feedback for it reads as a
    // malfunction rather than as a reward.
    const loud = loudest(fresh);
    if (loud === null) return;
    const cancel = celebrate(hapticFor(loud.type), announcementFor(loud, lineName));

    // The Line that just closed, which is not always the loudest Milestone: a Blackout
    // outranks the Bingo inside it and has no Line of its own to draw.
    const line = loudest(fresh.filter((m) => m.lineIndex !== null));
    if (line !== null && line.lineIndex !== null) {
      setLineCelebration({ lineIndex: line.lineIndex, key: line.id });
    }

    return cancel;
  }, [milestones.data, id]);

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
    // A Board rendered from counts that never arrived is a Board of 25 dormant Tiles and
    // an empty pip strip — a confident, wrong answer of exactly the kind `board.isError`
    // above exists to prevent. `isLoading` rather than `isPending`, because a disabled
    // query is pending forever and the Tiles are not fetched yet on the first render.
    if (counts.isLoading) {
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
    if (counts.isError) {
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

    // The three rules this projection encodes — the Centre is a Goal once decided, it is
    // marked rather than counted, and which squares that leaves complete — all live in
    // `src/domain/board.ts` now. They were inline here, which meant the screen restated
    // §12.3 in JSX and folded the completed positions by hand next to a tested function
    // that already did it.
    const boardTiles = renderTiles(tiles, counts.data ?? {});

    // Derived on every render from the counts already in hand — §13.1's Lines are never
    // stored, and `milestones` records that a Line was *reached* rather than which Lines
    // stand. The two are allowed to disagree: deleting an Increment empties a pip, and the
    // Milestone it earned stays, because it was pushed and cannot be unsent (§15.3).
    const lines = completedLines(completedOn(boardTiles));

    // The newest Milestone the card is willing to show. `milestones.data` arrives oldest
    // first, so the last match is the newest one; the headline is computed here rather
    // than in the JSX so the "is there one at all" test and the text are the same call.
    const cardMilestone = (() => {
      const all = milestones.data ?? [];
      for (let i = all.length - 1; i >= 0; i -= 1) {
        const milestone = all[i];
        if (milestone === undefined) continue;
        const headline = milestoneHeadline(milestone, lineName);
        if (headline !== null) return { milestone, headline };
      }
      return null;
    })();

    // An **empty** Tile opens nothing: it has no Goal to show and `tile_is_loggable()`
    // refuses Increments on it (§10.2), so a sheet there would be a sheet about nothing.
    //
    // The shared Centre does open, and §4.3 says what it looks like — a `clayTint` track,
    // no count, "We did it". It was a dead tap before: `goal` is null on the Centre because
    // the Goal it carries is a `family_goal`, so the square and its row in the list both
    // swallowed the press in silence.
    const openTile = boardTiles.find((t) => t.id === openTileId) ?? null;
    const sourceTile = tiles.find((t) => t.id === openTileId) ?? null;
    const sheetTile: SheetTile | null =
      openTile === null || sourceTile === null || openTile.goal === null
        ? null
        : {
            id: openTile.id,
            position: openTile.position,
            text: openTile.goal.text,
            target: openTile.goal.target,
            unit: openTile.goal.unit,
            unitCanonical: sourceTile.goal?.unit_canonical ?? null,
            count: openTile.count,
            isCentre: openTile.isCentre,
          };

    // The same two conditions `tile_is_loggable()` gates on, plus the one it cannot see:
    // whether this Board is the caller's to write on at all. `boards_read` is Family-wide,
    // so this route opens on anyone's Board.
    // Two different facts, not one flag. A single boolean told an owner looking at their
    // own frozen Board "Only this member can log progress here", which is false and
    // unhelpable. The Centre's own gate lives in `SheetTile.isCentre`.
    const blocked: 'frozen' | 'not-yours' | null =
      head.data.year.status === 'frozen'
        ? 'frozen'
        : !head.data.controlled
          ? 'not-yours'
          : null;

    // Whichever write failed last. Both mutations feed one line, because only one of them
    // can be in flight from a sheet showing a single Tile.
    const writeFailure =
      logIncrement.error !== null
        ? incrementFailureCopy(logIncrement.error)
        : deleteIncrement.error !== null
          ? incrementFailureCopy(deleteIncrement.error)
          : completeFamilyGoal.error !== null
            ? familyGoalFailureCopy(completeFamilyGoal.error)
            : null;

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
            celebrate={lineCelebration}
            onCelebrationDone={() => setLineCelebration(null)}
            // §3: the square opens the sheet and never logs directly — a mis-tap on a
            // 67pt target in a pocket must not write a row.
            onPressTile={(t) => {
              // An empty Tile opens nothing (§10.2): no Goal to show, and Increments are
              // refused there. Setting the id anyway left the sheet resolving to `null`
              // and the state quietly stale.
              if (t.goal !== null) setOpenTileId(t.id);
            }}
          />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
          {/* §4's Milestone card, and §13.4's whole argument in one component: a Bingo is
              a rung on a ladder, not an ending, so it is stated and then played past.

              Tiles are deliberately not eligible. Twenty-five of them land over a Year and
              a card that changed every few days would stop being read — the card is for
              the four or five things that happen rarely enough to still mean something.

              No count, no comparison, no "first" (§13.5): what happened, and when. */}
          {cardMilestone === null ? null : (
            <View
              accessible
              accessibilityLabel={`${cardMilestone.headline}, ${longDate(
                cardMilestone.milestone.createdAt,
              )}`}
              style={{
                marginTop: space.lg,
                marginHorizontal: space.xl,
                padding: space.lg,
                backgroundColor: color.paperRaised,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: color.hairline,
              }}
            >
              <Text style={{ ...styles.cardHead, color: color.ink }}>
                {cardMilestone.headline}
              </Text>
              <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xs }}>
                {longDate(cardMilestone.milestone.createdAt)}
              </Text>
            </View>
          )}

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

          {/* The sealed Board's goals, readable as a list.
              §4.1 takes the list away at seal — "the board isn't drawn until it seals" —
              and nothing put one back, so from January the only way to read your own
              twenty-four sentences was to tap twenty-four squares one at a time. The board
              stays pinned above and this scrolls under it, which is exactly what §3's
              "content scrolls under a pinned board" is for.

              Each row carries where the Goal sits, because the list and the grid are the
              same twenty-four things and a list that does not say which square it means
              cannot be matched back to one. Position order, not write order: this list
              exists to be read *against the board*. */}
          <View style={{ marginTop: space.xl, paddingHorizontal: space.xl }}>
            <Text style={{ ...styles.meta, color: color.ink3 }}>All goals</Text>
            {boardTiles
              .filter((t) => t.goal !== null)
              .map((t) => {
                const done = isTileComplete(t.count, t.goal?.target ?? 1);
                // §4.3: the Centre shows "no counts, no ordering" (§13.5). A Family Goal
                // has no Target to count toward — it is marked done — so "0/1" would be a
                // number invented to fill the column.
                const isCentre = t.isCentre;
                return (
                  <Pressable
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Row ${rowOf(t.position) + 1}, column ${
                      columnOf(t.position) + 1
                    }. ${t.goal?.text ?? ''}. ${
                      isCentre
                        ? `The centre.${done ? ' Done.' : ''}`
                        : `${t.count} of ${t.goal?.target ?? 1}.${done ? ' Complete.' : ''}`
                    }`}
                    onPress={() => setOpenTileId(t.id)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingVertical: space.md,
                      minHeight: size.minTouch,
                      borderTopWidth: 1,
                      borderTopColor: color.hairline,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    {/* Mono, like the drafting table's index and for the same reason: a
                        column of coordinates read down a list has to align. */}
                    <Text style={{ ...styles.index, color: color.ink3 }}>
                      {`R${rowOf(t.position) + 1}C${columnOf(t.position) + 1}`}
                    </Text>
                    <Text style={{ ...styles.body, color: color.ink, flex: 1 }}>
                      {t.goal?.text}
                    </Text>
                    <Text
                      style={{
                        ...styles.label,
                        // `moss` only once it is actually done — a count part-way there is
                        // not growth to be celebrated, it is a fact (§4.1). Never larger
                        // than `label`: §3 keeps the one big number in the sheet's ring.
                        color: done ? color.moss : isCentre ? color.clayDeep : color.ink2,
                      }}
                    >
                      {isCentre ? 'The centre' : `${t.count}/${t.goal?.target ?? 1}`}
                    </Text>
                  </Pressable>
                );
              })}
          </View>

          <Button
            label="Back"
            variant="text"
            style={{ marginTop: space.xl, marginHorizontal: space.xl, alignItems: 'flex-start' }}
            onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: head.data?.familyId ?? '' } })}
          />
        </ScrollView>

        <TileSheet
          tile={sheetTile}
          memberId={head.data.memberId}
          ownerName={head.data.isSelf ? null : head.data.memberName}
          recent={recent.data ?? []}
          recentPending={recent.isLoading}
          blocked={blocked}
          failure={writeFailure}
          family={(roster.data?.members ?? [])
            .filter((m) => m.status === 'active')
            .map((m) => ({
              id: m.id,
              name: m.display_name,
              managed: m.is_managed,
            }))}
          onClose={() => {
            setOpenTileId(null);
            // A refusal is about the tap, not the Tile. Left set, it greets whoever opens
            // the next square with a sentence about a write they never made.
            logIncrement.reset();
            deleteIncrement.reset();
            completeFamilyGoal.reset();
          }}
          onLog={(tap) => logIncrement.mutate(tap)}
          onDelete={(increment) => deleteIncrement.mutate(increment)}
          // §12.3 — offered only on the Centre, and only to a Member who may act. The
          // server checks all of this again; this is about not showing a button that
          // answers with an error.
          onCompleteFamilyGoal={
            sheetTile?.isCentre === true && blocked === null
              ? () =>
                  completeFamilyGoal.mutate({
                    yearId: head.data!.year.id,
                    memberId: head.data!.memberId,
                  })
              : undefined
          }
        />
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
