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
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { progressOf, stageOf } from '../src/domain/growth';
import { incrementVerb } from '../src/domain/increment';
import { columnOf, rowOf } from '../src/domain/lines';
import { shortDate } from '../src/domain/when';
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ProgressRing } from './ProgressRing';
import type { Increment, LogIncrement } from '../lib/queries/increments';

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
}

export function TileSheet({
  tile,
  memberId,
  ownerName,
  recent,
  recentPending,
  blocked,
  failure,
  family,
  onClose,
  onLog,
  onDelete,
  onCompleteFamilyGoal,
}: Props) {
  const [note, setNote] = useState('');
  const canLog = blocked === null;
  const [noteOpen, setNoteOpen] = useState(false);

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
      note: note.trim() === '' ? null : note.trim(),
    });
    setNote('');
    setNoteOpen(false);
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
                    borderWidth: 1,
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
