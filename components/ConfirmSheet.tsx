/**
 * Asking "are you sure" in a way that works on the platform this ships to.
 *
 * **`Alert.alert` does nothing on web.** React Native Web does not implement it — no
 * dialog, no error, no console warning by default. Four destructive actions used it
 * (taking back a Proposal, clearing a square, removing a Member, turning a pending Member
 * away), and on the deployed build every one of them was a control that visibly did
 * nothing when tapped. It was found by somebody trying to take back a Centre proposal.
 *
 * That is the reason this exists, but not the only reason it should have existed. An OS
 * alert is unstyled by definition — it is the system's dialog, in the system's font, with
 * the system's blue button. Dropping one into a design system whose §1.1 says *"there is
 * no red"* and reserves a specific treatment for destructive confirmation meant the one
 * moment the app asks a Member to think was the one moment it stopped looking like itself.
 *
 * So this is §1.1's treatment, in a sheet: `clayDeep` text on `paper` inside a `hairline`
 * border, with the way out below it. The same shape `<SwapSheet>` already uses for the
 * same purpose (§4.4), which is what a destructive confirm looks like in this app.
 */

import { Modal, Pressable, Text, View } from 'react-native';
import { styles } from '../theme/fonts';
import { color, radius, size, space, stroke } from '../theme/tokens';

export interface Confirmation {
  /** A question. §4.4's sheet asks "Swap this goal?"; these follow. */
  title: string;
  /** One line on what actually happens. Never a second copy of the title. */
  body: string;
  /** The destructive verb, not "OK" — a button that says what it does is the whole point. */
  confirmLabel: string;
  /** The way out. Named for the thing being kept, so it reads as a real choice. */
  cancelLabel: string;
  onConfirm: () => void;
}

/**
 * `null` closes it. Held by the caller as state rather than opened imperatively, because
 * an imperative dialog is exactly the API that made `Alert.alert` easy to reach for.
 */
export function ConfirmSheet({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation | null;
  onClose: () => void;
}) {
  if (confirmation === null) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Android's back button closes it, which is the same as choosing to keep.
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
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
        }}
      >
        <Text accessibilityRole="header" style={{ ...styles.title, color: color.ink }}>
          {confirmation.title}
        </Text>
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          {confirmation.body}
        </Text>

        {/* §1.1's destructive-confirm treatment, and the only one in the palette: clayDeep
            text on paper inside a hairline border. Not a filled button and emphatically not
            red — there is no red here, and somebody changing their mind has done nothing
            wrong. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${confirmation.confirmLabel}. ${confirmation.body}`}
          onPress={() => {
            // Closed first, so the sheet is gone by the time whatever this triggers starts
            // reporting. A sheet that lingered over its own result was the shape that made
            // two stacked modals a bug in slice 18.
            onClose();
            confirmation.onConfirm();
          }}
          style={({ pressed }) => ({
            marginTop: space.xl,
            height: size.controlPrimary,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.paper,
            borderWidth: stroke.hairline,
            borderColor: color.hairline,
            borderRadius: radius.card,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...styles.action, color: color.clayDeep }}>
            {confirmation.confirmLabel}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => ({
            height: size.control,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...styles.action, color: color.ink2 }}>
            {confirmation.cancelLabel}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
