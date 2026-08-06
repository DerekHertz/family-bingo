/**
 * The Account screen — Slice 19 (FRONTEND_DESIGN §4.6, PRD §1.5, §19.1).
 *
 * > Ordered by how often it's needed: **Families → people you look after → this handset**.
 * > Rows are hairline-divided `body`, values in `ink3`. Sign out is a plain text row.
 * > **Delete my account** is the `clayDeep`-on-hairline treatment at the bottom, with the
 * > consequence stated *above* the tap … No modal that says the same thing again.
 *
 * That ordering is the spec's, and it is the opposite of where a settings screen usually
 * starts: the thing a Member opens this screen for is almost always a Family or a child,
 * and almost never the handset. Sign out and delete sit at the bottom because they are
 * rare, not because they are dangerous.
 *
 * **A name lives on the Member, not on the Account.** Somebody in two Families is two
 * Members with two names (CONTEXT.md), so "change my name" is one control per Family
 * rather than one for the person — and that is why editing it here closes handoff open
 * item 5, where a magic-link Account was stuck with its email's local part forever.
 */

import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Loading, Trouble } from '../components/Screen';
import { signOut } from '../lib/auth';
import { useIsDemo } from '../lib/demo';
import { leaveTo } from '../lib/leave';
import {
  renameFailureCopy,
  useDeleteAccount,
  useManagedByMe,
  useRenameMember,
} from '../lib/queries/account';
import { useFamilies } from '../lib/queries/families';
import { useAnnounce } from '../lib/announce';
import { useSession } from '../lib/session';
import { styles } from '../theme/fonts';
import { color, radius, size, space, stroke } from '../theme/tokens';

export default function Account() {
  const router = useRouter();
  const session = useSession();
  const families = useFamilies(session?.user.id);
  const managed = useManagedByMe(session?.user.id);
  const rename = useRenameMember();
  const remove = useDeleteAccount();
  const { trouble, say, clear } = useAnnounce();
  // Which Membership's name is open for editing, and what it currently reads. One at a
  // time: a screen of live fields is a screen where a mistyped name saves itself.
  const [editing, setEditing] = useState<{ memberId: string; name: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * The public demo, and the two rows on this screen it has to take away.
   *
   * Everything about the *game* is already read-only, because the demo Family's Year is
   * frozen and §20.1 says what that means. This screen is not about a Year, so both of its
   * writes — the per-Family rename and §4.6's delete — are refused by `20260801000039`
   * instead, and a control whose only possible answer is no is what §0.3 rules out.
   */
  const readOnly = useIsDemo();

  // `/signin`, not `/`: `/` is the landing page, and this is somebody who was signed in a
  // moment ago. Signing out from the row below lands here too, which is the same answer.
  if (session === null) return <Redirect href="/signin" />;
  // `managed.isPending` is in this gate, not just around the list below it. The delete
  // paragraph's Managed-Member clause reads `(managed.data ?? []).length === 0` — so
  // `undefined` data says *no children*, and a Guardian on a slow connection could have
  // read a consequence that never mentioned their children and then tapped it. §4.6's one
  // hard requirement is that the consequence is stated above the tap.
  if (session === undefined || families.isPending || managed.isPending) {
    return <Loading what="Loading your account" />;
  }

  // And a *failed* read is never "no children" either. Without the answer there is no
  // honest consequence to state, so the control does not exist rather than existing with
  // a sentence that might be missing its most important clause.
  const childrenKnown = !managed.isError && managed.data !== undefined;
  const children = managed.data ?? [];

  const list = families.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop, paddingBottom: space.xxl }}
    >
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        You
      </Text>
      {/* The one fact about the Account rather than about a Member. `ink3` per §4.6's
          "values in `ink3`", and not editable: the email is the identity, and changing it
          is Supabase's flow rather than a row in a list. */}
      <Text style={{ ...styles.label, color: color.ink3, marginTop: space.xs }}>
        {session.user.email ?? 'Signed in'}
      </Text>

      <Section title="Families" />
      {list.length === 0 ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          You’re not in a family yet.
        </Text>
      ) : (
        list.map((family) => (
          <View key={family.id} style={row}>
            <Text style={{ ...styles.body, color: color.ink }}>{family.name}</Text>

            {editing?.memberId === family.member.id ? (
              <View style={{ marginTop: space.sm }}>
                <Field
                  value={editing.name}
                  onChangeText={(name) => setEditing({ memberId: family.member.id, name })}
                  accessibilityLabel={`Your name in ${family.name}`}
                  autoFocus
                  maxLength={60}
                />
                <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
                  <Button
                    label={rename.isPending ? 'Saving…' : 'Save'}
                    variant="outlined"
                    disabled={rename.isPending || editing.name.trim() === ''}
                    style={{ flex: 1 }}
                    onPress={() => {
                      clear();
                      rename.mutate(
                        { memberId: family.member.id, name: editing.name },
                        {
                          onSuccess: () => setEditing(null),
                          onError: (e) => say(renameFailureCopy(e)),
                        },
                      );
                    }}
                  />
                  <Button
                    label="Cancel"
                    variant="text"
                    style={{ flex: 1 }}
                    onPress={() => setEditing(null)}
                  />
                </View>
              </View>
            ) : readOnly ? (
              /* The demo. The same row, with nothing to tap: `members_self_update` is one
                 of the writes a frozen Year cannot reach, so `20260801000039` refuses it —
                 and a name a visitor could change is a name every later visitor would then
                 see, which would make the banner's "change nothing" untrue. */
              <View style={{ minHeight: size.minTouch, justifyContent: 'center' }}>
                <Text style={{ ...styles.label, color: color.ink3 }}>
                  {family.member.display_name}
                  {family.member.role === 'organizer' ? ' · organizer' : ''}
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Your name in ${family.name} is ${family.member.display_name}. Change it.`}
                onPress={() => {
                  setConfirmingDelete(false);
                  setEditing({ memberId: family.member.id, name: family.member.display_name });
                }}
                style={({ pressed }) => ({
                  minHeight: size.minTouch,
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ ...styles.label, color: color.ink3 }}>
                  {family.member.display_name}
                  {family.member.role === 'organizer' ? ' · organizer' : ''}
                </Text>
              </Pressable>
            )}

          </View>
        ))
      )}

      <Section title="People you look after" />
      {managed.isError ? (
        // Never "Nobody yet." A failed read presented as a fact tells a Guardian they look
        // after nobody, which is the confident-wrong-answer shape §0.3 rules out.
        <Trouble
          live={false}
          message="Couldn’t load the people you look after just now."
        />
      ) : children.length === 0 ? (
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md }}>
          Nobody yet. You can add a child profile from a family’s screen.
        </Text>
      ) : (
        children.map((child) => (
          <View key={child.id} style={row}>
            <Text style={{ ...styles.body, color: color.ink }}>{child.displayName}</Text>
            <Text style={{ ...styles.label, color: color.ink3, marginTop: space.xs }}>
              {child.familyName}
            </Text>
          </View>
        ))
      )}

      <Section title="This handset" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        accessibilityHint="What this handset is allowed to interrupt you for"
        onPress={() => {
          // Disarms the delete guard. It is two taps rather than two screens, and a
          // Member who armed it, went to look at something else and came back would
          // otherwise return to what reads as an unarmed button and is not.
          setConfirmingDelete(false);
          router.push('/account/notifications');
        }}
        style={({ pressed }) => ({ ...row, opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={{ ...styles.body, color: color.ink }}>Notifications</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setConfirmingDelete(false);
          // A failed sign-out is a row that visibly does nothing; say so rather than
          // leaving an unhandled rejection.
          void signOut().catch(() => say('Couldn’t sign out just now. Try again in a moment.'));
        }}
        style={({ pressed }) => ({ ...row, opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={{ ...styles.body, color: color.ink }}>Sign out</Text>
      </Pressable>

      {/* `live={false}`: `say()` is the only way this appears, and
          `accessibilityLiveRegion` is Android-only while `announceForAccessibility` fires
          on both — together they read the sentence twice on TalkBack. */}
      <Trouble message={trouble} live={false} />

      {/* §4.6's delete. The consequence is stated **above** the tap and there is no modal
          that says it again — a second screen repeating the same sentence is a screen that
          teaches people to dismiss sentences.

          **The copy says what the server does, not what §4.6 does.** §4.6 says "Managed
          Members transfer"; `delete_account()` implements §1.5 literally, and `members`
          cascades from `accounts` by `guardian_account_id` as well as `account_id` — so a
          Guardian deleting their Account deletes their children's Boards too. The
          migration flags that as a known spec conflict resolved in favour of the PRD, and
          this screen is the last place it could be softened into a lie. If the product
          decides transfer is right, the function changes and so does this paragraph. */}
      {/* **Absent in the demo, not disabled.**
          The demo Account is shared, and `delete_account()` on it would take the Family,
          the Year and the Wrapped with it — one tap on this row would end the demo for
          everybody. `20260801000039` guards the `accounts` delete so it cannot happen, but
          a control that exists only to be refused is §0.3's failure, and this particular
          one would be refused *after* somebody had read a paragraph telling them their
          boards were about to leave. The whole section goes. */}
      {readOnly ? null : (
        <>
      <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xxl }}>
        Deleting
      </Text>
      <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
        Your boards leave every Year, including the frozen ones. Each family keeps its own.
        {children.length === 0
          ? ''
          : ` The ${children.length === 1 ? 'profile' : 'profiles'} you look after ${
              children.length === 1 ? 'goes' : 'go'
            } too, with their boards.`}{' '}
        This cannot be undone.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          confirmingDelete ? 'Yes, delete my account' : 'Delete my account'
        }
        // Never offered without the answer the consequence above depends on.
        disabled={remove.isPending || !childrenKnown}
        onPress={() => {
          // Two taps, not two screens. The second tap is the confirmation §4.6 wants
          // without the modal it forbids: the button restates itself in place, so the
          // consequence above stays on screen while the Member decides.
          if (!confirmingDelete) {
            setConfirmingDelete(true);
            // Neither VoiceOver nor TalkBack re-announces a changed label on an element
            // that already has focus, so without this the first tap is completely silent —
            // and the natural reading of silence is "that did not register", followed by a
            // second tap. §4.6 forbids a modal, not feedback.
            say('Tap again to delete your account. This cannot be undone.');
            return;
          }
          remove.mutate(undefined, {
            onError: () => say('That didn’t work. Have another go in a moment.'),
          });
        }}
        style={({ pressed }) => ({
          marginTop: space.lg,
          height: size.control,
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
          {remove.isPending
            ? 'Deleting…'
            : confirmingDelete
              ? 'Yes, delete my account'
              : 'Delete my account'}
        </Text>
      </Pressable>

      {confirmingDelete && !remove.isPending ? (
        <Button
          label="Keep it"
          variant="text"
          style={{ marginTop: space.sm }}
          onPress={() => setConfirmingDelete(false)}
        />
      ) : null}
        </>
      )}

      <Button
        label="Back"
        variant="text"
        style={{ marginTop: space.xl, alignItems: 'flex-start' }}
        // Not `router.back()`: `/account` is deep-linkable and can be first on the stack,
        // and on an empty history that row does nothing at all.
        onPress={() => leaveTo('/home')}
      />
    </ScrollView>
  );
}

/** §4.6's hairline-divided rows. One shape, so the three sections cannot drift apart. */
const row = {
  paddingVertical: space.md,
  borderTopWidth: stroke.hairline,
  borderTopColor: color.hairline,
  minHeight: size.minTouch,
  justifyContent: 'center',
} as const;

function Section({ title }: { title: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ ...styles.meta, color: color.ink3, marginTop: space.xxl }}
    >
      {title}
    </Text>
  );
}
