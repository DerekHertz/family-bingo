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
import { styles } from '../theme/fonts';
import { color, radius, size, space } from '../theme/tokens';
import { ProgressRing } from './ProgressRing';
import type { Increment } from '../lib/queries/increments';

export interface SheetTile {
  id: string;
  position: number;
  text: string;
  target: number;
  unit: string | null;
  unitCanonical: string | null;
  count: number;
}

interface Props {
  tile: SheetTile | null;
  memberId: string;
  /** Whose Board this is, for the header — "Your goal" reads wrong on a child's Board. */
  ownerName: string | null;
  recent: Increment[];
  recentPending: boolean;
  /** False on a frozen Year or somebody else's Board: the sheet reads, it does not write. */
  canLog: boolean;
  onClose: () => void;
  onLog: (tap: { id: string; tileId: string; memberId: string; note: string | null }) => void;
  onDelete: (increment: { id: string; tileId: string }) => void;
}

const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function TileSheet({
  tile,
  memberId,
  ownerName,
  recent,
  recentPending,
  canLog,
  onClose,
  onLog,
  onDelete,
}: Props) {
  const [note, setNote] = useState('');
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
        style={{ flex: 1, backgroundColor: 'rgba(51, 48, 42, 0.35)' }}
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
            <ProgressRing count={tile.count} target={tile.target} progress={progress} />
          </View>

          {canLog ? (
            <>
              <Pressable
                accessibilityRole="button"
                // §6 A6: the label carries the goal text, because "Walked one" alone is
                // meaningless read out of context.
                accessibilityLabel={`${incrementVerb(tile.unit, tile.unitCanonical)}. ${tile.text}`}
                // §5: haptic on touch-down, not on the server's answer. The tap is the
                // reward and it should land under the finger.
                onPressIn={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                onPress={log}
                style={({ pressed }) => ({
                  height: 56,
                  marginTop: space.lg,
                  borderRadius: radius.card,
                  backgroundColor: color.moss,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ ...styles.heading, color: color.paper }}>
                  {incrementVerb(tile.unit, tile.unitCanonical)}
                </Text>
              </Pressable>

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
                    minHeight: 46,
                    borderWidth: 1,
                    borderColor: color.hairline,
                    borderRadius: radius.card,
                  }}
                />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a note"
                  onPress={() => setNoteOpen(true)}
                  style={({ pressed }) => ({
                    height: 46,
                    marginTop: space.md,
                    borderRadius: radius.card,
                    borderWidth: 1,
                    borderColor: color.hairline,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ ...styles.body, color: color.ink2 }}>Add a note</Text>
                </Pressable>
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
              {complete ? 'This one is done.' : 'Only this member can log progress here.'}
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
                    {dateOf(increment.occurredAt)}
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
                    accessibilityLabel={`Remove the increment from ${dateOf(increment.occurredAt)}`}
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
