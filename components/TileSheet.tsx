/**
 * The tile sheet (FRONTEND_DESIGN §3, PRD §11).
 *
 * Where one tap becomes an Increment. **Logging lives here and never on the board itself** —
 * a mis-tap on a 67pt target in a pocket must not write a row, so the square opens this and
 * this carries the button.
 *
 * §3's parts, in order: the ring, the primary action, the optional secondary, and the last
 * three Increments. The only mutation an Increment permits is deletion (§11.3) — there is
 * no edit, and a mistake is corrected by removing the row rather than rewriting it.
 *
 * §3 lists **two** secondaries — "Add a note" / "Add a photo", 46pt, hairline outline,
 * "Optional, always. Never required, never pre-focused." Both are disclosures rather than
 * fields sitting open above the button, because a control waiting to be filled in is a
 * control that reads as required.
 *
 * Picking the photo is called from here rather than passed in as a prop. It is a device
 * interaction in the same family as `Haptics` and `Crypto.randomUUID()` above — a picker
 * that returns to the caller — and not a data fetch: nothing is read from or written to
 * Supabase until the log button is pressed. Holding it here also keeps the chosen photo
 * beside the note it belongs with, in the one component that already owns "what this tap
 * will say".
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import {
  photoPermissionCopy,
  photoUnreadableCopy,
} from '../src/domain/attachment';
import { progressOf, stageOf } from '../src/domain/growth';
import { incrementVerb, occurredAtFor } from '../src/domain/increment';
import { columnOf, rowOf } from '../src/domain/lines';
import { queuedCopy } from '../src/domain/queue';
import { shortDate } from '../src/domain/when';
import { styles } from '../theme/fonts';
import { color, radius, size, space, stroke } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ProgressRing } from './ProgressRing';
import { discardPhoto, pickPhoto, type PickedPhoto } from '../lib/photo';
import type { Increment, LogIncrement } from '../lib/queries/increments';

/**
 * The chosen photo's thumbnail, before it is anything at all.
 *
 * Deliberately not §3's 150pt: that is the Feed's size, where the photo is the point of
 * the row. Here it is a confirmation that the right picture is attached, sitting beside a
 * button, and 64 keeps the primary action on screen without scrolling.
 */
const PREVIEW = 64;

export interface SheetTile {
  id: string;
  position: number;
  text: string;
  target: number;
  unit: string | null;
  unitCanonical: string | null;
  count: number;
  /**
   * The shared Centre is a different sheet (§4.3): a `clayTint` ring track — the fill
   * stays `moss`, progress is always `moss` — and the app's only plural verb, "We did it".
   *
   * It also takes no Increments at all: `tile_is_loggable()` refuses them because a Family
   * Goal has no Target and is *marked done* by any Member, completing for everyone at once
   * (§12.3) — which is what `onCompleteFamilyGoal` does, and why the Centre carries no
   * ring count: there is nothing to count toward.
   */
  isCentre: boolean;
}

interface Props {
  tile: SheetTile | null;
  memberId: string;
  /** The Family this Board belongs to — the first segment of an Attachment's key (§16.2). */
  familyId: string;
  /**
   * When this Board sealed, and the floor under every `occurred_at` this sheet mints.
   *
   * Passed in because the sheet is the only place a tap's timestamp is decided and
   * `stamp_increment()` refuses anything below the seal with `PT403` — see `occurredAtFor`
   * for what a handset with a wrong clock does without it.
   */
  sealedAt: string | null;
  /** Whose Board this is, for the header — "Your goal" reads wrong on a child's Board. */
  ownerName: string | null;
  recent: Increment[];
  recentPending: boolean;
  /**
   * Why this sheet cannot log, or `null` when it can.
   *
   * A boolean was not enough: it collapsed "the Year is frozen" and "this is not your
   * Board" into one flag, and the one sentence behind it told an owner looking at their
   * own frozen Board *"Only this member can log progress here."* Two different facts
   * deserve two different sentences (§0.3).
   */
  blocked: 'frozen' | 'not-yours' | null;
  /** Set when the last write failed. Already phrased — see `incrementFailureCopy`. */
  failure: string | null;
  /**
   * The soft half of the same story: the tap landed, something optional about it did not.
   * Already phrased — see `photoOutcomeCopy`.
   *
   * Separate from `failure` because it gets a different treatment. A refusal sits in a
   * `clayTint` block; this is `ink2` on the sheet's own ground, because §1.1 says a failed
   * upload is plain words and because nothing here went wrong enough to be framed.
   */
  notice: string | null;
  /**
   * How many taps are waiting on this device (§17.3).
   *
   * Passed in rather than read here: a component in this codebase does no data fetching,
   * and the count comes from `useQueuedCount()` on the screen. Shown at all because a
   * Member who logged three walks underground and watched the ring move has no other way
   * to know the app kept them.
   */
  queued: number;
  /**
   * §4.3 — the Family, in join order, for the shared Centre's contributors block.
   *
   * "**no counts, no ordering** (§13.5)": they are shown because the square is theirs, not
   * because of anything they did more or less of than each other. Join order is the one
   * ordering that says nothing about achievement.
   */
  family?: readonly { id: string; name: string; managed: boolean }[] | undefined;
  onClose: () => void;
  onLog: (tap: LogIncrement) => void;
  onDelete: (increment: { id: string; tileId: string }) => void;
  /**
   * §12.3 — mark the shared Family Goal done. Only ever passed for the Centre, and only
   * when this Member may do it; `undefined` renders the state as a fact instead.
   */
  onCompleteFamilyGoal?: (() => void) | undefined;
  /**
   * §4.4 — open the Swap confirm sheet for this square.
   *
   * `undefined` whenever a Swap is impossible, and the caller decides that rather than
   * this component, because the four reasons are four different facts about the Board and
   * the Year (`evaluateGoalRewrite`). A row offered here that the server would refuse is
   * the exact failure §0.3 forbids — asking for a retry that cannot work.
   */
  onSwap?: (() => void) | undefined;
}

export function TileSheet({
  tile,
  memberId,
  familyId,
  sealedAt,
  ownerName,
  recent,
  recentPending,
  blocked,
  failure,
  notice,
  queued,
  family,
  onClose,
  onLog,
  onDelete,
  onCompleteFamilyGoal,
  onSwap,
}: Props) {
  const [note, setNote] = useState('');
  const canLog = blocked === null;
  const [noteOpen, setNoteOpen] = useState(false);
  /** The photo chosen for the tap that has not happened yet (§16.1 — one, and optional). */
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  /** What the picker had to say. Cleared the moment a photo is chosen. */
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  /**
   * The chosen photo, mirrored where an unmount cleanup can still read it.
   *
   * A cleanup closes over the state it was rendered with, so a `[photo]` effect would run
   * its cleanup on every *change* and a `[]` one would see `null` forever. The ref is the
   * only way the last value survives to the teardown.
   */
  const chosen = useRef<PickedPhoto | null>(null);
  useEffect(() => {
    chosen.current = photo;
  }, [photo]);

  /**
   * Leaving the sheet takes the picker's original with it (§7.6's instinct, `discardPhoto`).
   *
   * The sheet is keyed on the square in `app/board/[id].tsx`, so this fires when a Member
   * opens a different Tile as well as when they close the sheet — and both are moments
   * after which nothing will ever read that file again.
   */
  useEffect(
    () => () => {
      if (chosen.current !== null) discardPhoto(chosen.current);
    },
    [],
  );

  /** Put a chosen photo down: the state, and the full-resolution file behind it. */
  const forgetPhoto = () => {
    if (photo !== null) discardPhoto(photo);
    setPhoto(null);
  };

  if (tile === null) return null;

  const progress = progressOf(tile.count, tile.target);
  const complete = stageOf(tile.count, tile.target) === 'complete';
  const where = `Row ${rowOf(tile.position) + 1}, column ${columnOf(tile.position) + 1}`;

  const log = () => {
    // §11.2 — the id is minted here, on the device, before the request. A retry of a tap
    // whose response was lost carries the same id and lands exactly once, which is the
    // whole reason the offline queue of §17.4 is safe.
    onLog({
      id: Crypto.randomUUID(),
      tileId: tile.id,
      memberId,
      familyId,
      note: note.trim() === '' ? null : note.trim(),
      // Minted here too, and for the same reason: this is when the Member says it
      // happened, and a tap held in the queue for three days must still carry Monday
      // (§17.3). Everything downstream — the optimistic row, the queued row, the replay —
      // uses this one value.
      //
      // Through `occurredAtFor`, not raw, and that is not defensive tidying: sending this
      // column at all is new in slice 17, and `stamp_increment()` refuses anything below
      // `least(sealed_at, now())` with `PT403` — which `classifyDelivery` drops. A handset
      // whose clock has reset to the factory date would fail every tap for the rest of the
      // Year, online with an unhelpable message and offline in silence.
      occurredAt: occurredAtFor(new Date().toISOString(), sealedAt),
      photo,
    });
    setNote('');
    setNoteOpen(false);
    // The upload reads `photo.body`, which is already in memory, so the picker's original
    // has nothing left to do the moment the tap is handed over.
    forgetPhoto();
    setPickNotice(null);
  };

  /**
   * §3's second secondary. The permission is asked here, at the moment it is needed, and
   * a refusal is a Member's answer rather than an error (§0.3) — one plain sentence saying
   * where the switch is, and no second ask.
   */
  const addPhoto = () => {
    if (picking) return;
    setPicking(true);
    void pickPhoto()
      .then((outcome) => {
        if (outcome.kind === 'photo') {
          setPhoto(outcome.photo);
          setPickNotice(null);
          return;
        }
        // Cancelling says nothing at all. Changing your mind is not an event.
        if (outcome.kind === 'cancelled') return;
        setPickNotice(
          outcome.kind === 'denied' ? photoPermissionCopy : photoUnreadableCopy,
        );
      })
      .finally(() => setPicking(false));
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // Android's back button closes the sheet rather than leaving the screen.
      accessibilityViewIsModal
    >
      {/* §3: the board is dimmed to 35% behind. Tapping the dim closes — the sheet is a
          detail view, and a Member who opened the wrong square should not have to aim. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: color.scrim }}
      />

      <View
        style={{
          backgroundColor: color.paperRaised,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          paddingHorizontal: space.xl,
          paddingTop: space.xl,
          paddingBottom: space.xxl,
          maxHeight: '82%',
        }}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={{ ...styles.meta, color: color.ink3 }}>{where}</Text>
          <Text
            accessibilityRole="header"
            style={{ ...styles.cardHead, color: color.ink, marginTop: space.xs }}
          >
            {tile.text}
          </Text>
          {ownerName === null ? null : (
            <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
              {ownerName}
            </Text>
          )}

          <View style={{ alignItems: 'center', marginTop: space.lg }}>
            <ProgressRing
              count={tile.count}
              target={tile.target}
              progress={progress}
              // §4.3: the Centre's track is `clayTint` because clay means family. The fill
              // is never anything but `moss` — progress is progress on every square.
              track={tile.isCentre ? color.clayTint : color.paperSunk}
              showCount={!tile.isCentre}
            />
          </View>

          {tile.isCentre ? (
            complete || onCompleteFamilyGoal === undefined ? (
              <Text
                style={{
                  ...styles.body,
                  color: color.ink2,
                  marginTop: space.lg,
                  textAlign: 'center',
                }}
              >
                {complete
                  ? 'We did it — your family finished this one together.'
                  : 'Your family decides when this one is done.'}
              </Text>
            ) : (
              // §4.3: "the increment verb is the app's only plural — 'We did it'". It
              // completes for every Member at once (§12.3), which is why the word is
              // *we* and why this is the only button in the app that speaks for more
              // than the person pressing it — and why it is `tone="clay"`, because clay
              // means family and nothing else (§1.1).
              <Button
                label="We did it"
                variant="primary"
                tone="clay"
                // §6 A6: the label carries the goal, because "We did it" alone is
                // meaningless read out of context.
                accessibilityLabel={`We did it. ${tile.text}`}
                accessibilityHint="Marks the family's goal done for everyone"
                // `light`, not `success`. §5 gives `success` to *tile complete*, which is
                // the Milestone landing — and this fires on touch-down, before the RPC has
                // been answered, so a refused press would otherwise congratulate a Member
                // for something that did not happen.
                onPressIn={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                onPress={onCompleteFamilyGoal}
                style={{ marginTop: space.lg }}
              />
            )
          ) : canLog ? (
            <>
              {/* §3's primary action — 56pt moss, `paper` at 17pt/700 — which is exactly
                  `<Button variant="primary">`. It was hand-rolled for the growth
                  behaviour: §6 A4 gives the sheet the *full* Dynamic Type range and a
                  fixed 56 truncates the label at XXL instead of growing with it. `Button`
                  treats its height as a floor now, so every button in the app does that. */}
              <Button
                label={incrementVerb(tile.unit, tile.unitCanonical)}
                variant="primary"
                // §6 A6: the label carries the goal text, because "Walked one" alone is
                // meaningless read out of context.
                accessibilityLabel={`${incrementVerb(tile.unit, tile.unitCanonical)}. ${tile.text}`}
                // §5: haptic on touch-down, not on the server's answer. The tap is the
                // reward and it should land under the finger.
                onPressIn={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                onPress={log}
                style={{ marginTop: space.lg }}
              />

              {/* Optional, always (§11.1). Never required, never pre-focused — which is
                  why this is a disclosure rather than a field sitting open above the
                  button, waiting to be filled in. */}
              {noteOpen ? (
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="A note, if you want one"
                  placeholderTextColor={color.ink3}
                  multiline
                  style={{
                    ...styles.body,
                    color: color.ink,
                    marginTop: space.md,
                    padding: space.md,
                    minHeight: size.controlSharpen,
                    borderWidth: stroke.hairline,
                    borderColor: color.hairline,
                    borderRadius: radius.card,
                  }}
                />
              ) : (
                // §3's secondary: "46pt, hairline outline", which is `<Button
                // variant="outlined">` at `size.controlSharpen`. It reads one step louder
                // than the hand-rolled copy did — `action`/`ink` rather than `body`/`ink2`
                // — because that is what an outlined control is everywhere else in the
                // app. §3 specifies only the height and the outline for this one, and a
                // second text treatment for a single button would be the fifth variant
                // `<Button>` exists to avoid.
                <Button
                  label="Add a note"
                  height={size.controlSharpen}
                  // `outlined`'s `paperRaised` fill is the sheet's own ground, so the
                  // button reads as an outline exactly as the transparent copy did.
                  onPress={() => setNoteOpen(true)}
                  style={{ marginTop: space.md }}
                />
              )}

              {/* §3's other 46pt secondary, and §16.1's one optional photo. Beside "Add a
                  note" and identical to it in weight, because they are the same kind of
                  thing: something a Member may do and never has to. */}
              {photo === null ? (
                // The same control as "Add a note" above, and it was a hand-rolled
                // `<Pressable>` beside it. §3 lists the two as one pair of secondaries —
                // "46pt, hairline outline" — so two renderings of one thing is the app
                // disagreeing with itself in the two rows where the disagreement is
                // side by side: `body`/`ink2` against `action`/`ink`, and a literal
                // `borderWidth: 1` where the token is `stroke.hairline`. `<Button>` is
                // also where §6 A3's 44pt floor and §6 A4's growth live, both of which a
                // fixed `minHeight` opted out of.
                <Button
                  label="Add a photo"
                  height={size.controlSharpen}
                  disabled={picking}
                  onPress={addPhoto}
                  style={{ marginTop: space.md }}
                />
              ) : (
                /* What is about to be attached, and a way out of it. The thumbnail is the
                   **original** local file rather than anything signed — nothing has been
                   uploaded yet, and there is no URL to speak of until the tap lands. */
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    marginTop: space.md,
                    padding: space.sm,
                    borderRadius: radius.card,
                    // The token, not a literal 1 — §1 gives the rule one width and this
                    // row sits directly under a `<Button variant="outlined">` drawn from it.
                    borderWidth: stroke.hairline,
                    borderColor: color.hairline,
                  }}
                >
                  <Image
                    source={{ uri: photo.previewUri }}
                    accessibilityIgnoresInvertColors
                    // Decorative: the row's own label says a photo is attached, and a
                    // Member cannot be told what is in their own picture by an app.
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      width: PREVIEW,
                      height: PREVIEW,
                      borderRadius: radius.card,
                      backgroundColor: color.paperSunk,
                    }}
                  />
                  <Text style={{ ...styles.body, color: color.ink2, flex: 1 }}>
                    A photo is attached.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove the photo from this one"
                    onPress={forgetPhoto}
                    style={({ pressed }) => ({
                      minHeight: size.minTouch,
                      justifyContent: 'center',
                      paddingHorizontal: space.sm,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    {/* `clayDeep`, never red (§1.1). Same treatment as removing an
                        Increment below, because it is the same kind of undoing. */}
                    <Text style={{ ...styles.label, color: color.clayDeep }}>Remove</Text>
                  </Pressable>
                </View>
              )}

              {/* The picker's answer — a declined permission, or a file that would not
                  read. §1.1: `ink2` and plain words, never colour, never a block. */}
              {pickNotice === null ? null : (
                <Text
                  accessibilityLiveRegion="polite"
                  style={{ ...styles.body, color: color.ink2, marginTop: space.md }}
                >
                  {pickNotice}
                </Text>
              )}
            </>
          ) : (
            <Text
              style={{
                ...styles.label,
                color: color.ink3,
                marginTop: space.lg,
                textAlign: 'center',
              }}
            >
              {blocked === 'frozen'
                ? 'This year is finished. Nothing more can be logged.'
                : `${ownerName ?? 'This member'} logs progress on this one.`}
            </Text>
          )}

          {/* §4.4's way in. Below the logging controls and quieter than them, because
              swapping is the rarer thing by two orders of magnitude — a Member logs
              hundreds of Increments a year and has three of these.

              Rendered only when the caller passed a handler, which it does only when
              `evaluateGoalRewrite()` says the Swap would be allowed. A row here on the
              shared Centre, a completed Tile, a frozen Year or an exhausted budget would
              be a row that opens a sheet whose only button the server refuses. */}
          {onSwap === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Swap this goal. ${tile.text}`}
              accessibilityHint="Shows what it costs before anything changes"
              onPress={onSwap}
              style={({ pressed }) => ({
                minHeight: size.minTouch,
                marginTop: space.lg,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ ...styles.body, color: color.ink2 }}>Swap this goal</Text>
            </Pressable>
          )}

          {/* §4.3: "Contributors render as faces in join order inside a `clayTint` block:
              no counts, no ordering (§13.5)." The shared Centre belongs to the Family
              rather than to whoever proposed it or whoever pressed the button, so the
              block is everyone — and it is deliberately not a leaderboard of who did what.
              Clay, because clay means family and nothing else (§1.1). */}
          {tile.isCentre && family !== undefined && family.length > 0 ? (
            <View
              style={{
                marginTop: space.lg,
                padding: space.md,
                borderRadius: radius.card,
                backgroundColor: color.clayTint,
              }}
            >
              <Text style={{ ...styles.meta, color: color.clayDeep }}>Together</Text>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: space.sm,
                  marginTop: space.md,
                }}
              >
                {family.map((member) => (
                  <Avatar key={member.id} name={member.name} size={34} managed={member.managed} />
                ))}
              </View>
            </View>
          ) : null}

          {/* A refused write said nothing at all before this: the optimistic count rolled
              back and the Member watched their tap quietly undo itself. `PT403` and
              `42501` never appear in the message text, so the copy is matched on the
              SQLSTATE (`incrementFailureCopy`) — and none of it asks for a retry that is
              guaranteed to fail (§0.3). */}
          {failure === null ? null : (
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={failure}
              style={{
                marginTop: space.md,
                padding: space.md,
                borderRadius: radius.card,
                backgroundColor: color.clayTint,
              }}
            >
              <Text style={{ ...styles.body, color: color.clayDeep }}>{failure}</Text>
            </View>
          )}

          {/* The tap landed and something optional about it did not — a photo that had no
              connection to go over (§17.1), or an upload that failed. Plain `ink2` on the
              sheet's own ground: §1.1 gives failed uploads and offline state words rather
              than colour, and this is not a refusal to be framed like one. */}
          {notice === null ? null : (
            <Text
              accessibilityLiveRegion="polite"
              style={{ ...styles.body, color: color.ink2, marginTop: space.md }}
            >
              {notice}
            </Text>
          )}

          {/* §17.3, said out loud. A standing fact rather than an event: it is here for as
              long as there are taps on the device and disappears when they land. Not a
              spinner, not a badge, and never a number the Member has to act on. */}
          {queuedCopy(queued) === null ? null : (
            <Text style={{ ...styles.label, color: color.ink2, marginTop: space.md }}>
              {queuedCopy(queued)}
            </Text>
          )}

          <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xl }}>Recent</Text>

          {recentPending ? (
            <ActivityIndicator
              color={color.ink3}
              accessibilityLabel="Loading recent progress"
              style={{ marginTop: space.md, alignSelf: 'flex-start' }}
            />
          ) : recent.length === 0 ? (
            <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
              Nothing logged yet.
            </Text>
          ) : (
            recent.map((increment) => (
              <View
                key={increment.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingVertical: space.md,
                  borderTopWidth: 1,
                  borderTopColor: color.hairline,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ ...styles.label, color: color.ink2 }}>
                    {shortDate(increment.occurredAt)}
                  </Text>
                  <Text
                    style={{
                      ...styles.body,
                      color: increment.note === null ? color.ink3 : color.ink,
                      marginTop: space.xs,
                    }}
                  >
                    {increment.note ?? 'No note'}
                  </Text>
                </View>
                {canLog ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove the increment from ${shortDate(increment.occurredAt)}`}
                    onPress={() => onDelete({ id: increment.id, tileId: increment.tileId })}
                    style={({ pressed }) => ({
                      minHeight: size.minTouch,
                      justifyContent: 'center',
                      paddingHorizontal: space.sm,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    {/* `clayDeep`, never red (§3). Removing a tap you did not mean to make
                        is housekeeping, and nothing in this system scolds (§0.3). */}
                    <Text style={{ ...styles.label, color: color.clayDeep }}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              minHeight: size.minTouch,
              marginTop: space.lg,
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...styles.body, color: color.ink2 }}>Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
