/**
 * Add a child — Slice 4 (PRD §4, FRONTEND_DESIGN §4.7).
 *
 * > The setup sheet states the whole contract before the button, in three `clay`-bulleted
 * > lines, because these are the rules a Guardian is agreeing to.
 *
 * That ordering is the point. §4.3 says the Guardian is accountable for everything posted
 * under this profile, and the compliance note in §4 says the design exists so parental
 * consent is *inherent* rather than bolted on — which only holds if the Guardian read the
 * terms before the profile existed, not in a settings screen afterwards.
 *
 * There is no email field and no invite option, and there never will be: §4.4 makes a
 * Managed Member an identity with no login at all, and converting one to a real Account is
 * explicitly out of scope.
 */

import { useLocalSearchParams } from 'expo-router';
import { AccessibilityInfo, Text, View } from 'react-native';
import { useState } from 'react';
import { leaveTo } from '../../lib/leave';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { FormScreen, Trouble } from '../../components/Screen';
import { useAnnounce } from '../../lib/announce';
import { managedMemberFailureCopy, useCreateManagedMember } from '../../lib/queries/managed';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/**
 * §4.7's three lines, in its order.
 *
 * Handover is last and is a promise rather than a feature: §4.4 puts conversion out of
 * scope, and §4.7 asks that the day it arrives is designed for from the start. Saying so
 * here is what stops "they can never have their own login" being a surprise years later.
 */
const CONTRACT = [
  {
    title: 'It says their name',
    body: 'Everything you log for them shows as theirs. A small clay dot is the only sign you tapped it.',
  },
  {
    title: 'It stays in the Family',
    body: 'Their name and face never leave it. The Almanac exports numbers only — no photos, nobody named.',
  },
  {
    title: 'It moves with them',
    body: 'When they get a phone of their own, the profile transfers whole — same board, same year, same tiles, dot removed.',
  },
] as const;

export default function AddChild() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const { trouble, say, clear } = useAnnounce();
  const create = useCreateManagedMember(id ?? '');

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      say('What should we call them?');
      return;
    }
    clear();
    create.mutate(trimmed, {
      onSuccess: () => {
        // Announced but NOT put on screen, which is why this is `AccessibilityInfo`
        // directly rather than `say()`: the screen is leaving, so there is nothing for a
        // sentence to sit on. Every failure announced and success did not, which for a
        // screen that navigates away leaves a VoiceOver user with no confirmation
        // anything happened (§6).
        AccessibilityInfo.announceForAccessibility(`${trimmed} is in the Family.`);
        leaveTo({ pathname: '/family/[id]', params: { id: id ?? '' } });
      },
      // The copy lives beside the mutation, so it is read against the migration rather
      // than against this screen (`managedMemberFailureCopy`).
      onError: (e) => say(managedMemberFailureCopy(e)),
    });
  };

  return (
    <FormScreen>
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        Add a child
      </Text>
      <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
        They play through your account — no email, no password, nothing for them to
        forget.
      </Text>
      {/* §4.7's closing line. Both are CHECK-enforced in the schema, so saying them here
          is describing the app rather than promising something it has to remember. */}
      <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
        They get no notifications, and they can&rsquo;t be sent an invite.
      </Text>

      <View style={{ marginTop: space.xl, gap: space.lg }}>
        {CONTRACT.map((rule) => (
          <View
            key={rule.title}
            // One stop per rule, not two. Ungrouped, each bullet was a title and a body
            // read as separate items with no relationship between them (§6).
            accessible
            accessibilityLabel={`${rule.title}. ${rule.body}`}
            style={{ flexDirection: 'row', gap: space.md }}
          >
            {/* Clay means family, and this is the most family thing in the app (§1.1). */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: size.dot,
                height: size.dot,
                marginTop: space.sm,
                borderRadius: radius.pill,
                backgroundColor: color.clay,
              }}
            />
            <View style={{ flex: 1 }}>
              {/* `heading` rather than body with a dead fontWeight: text() strips weight,
                  so overriding it did nothing and the title rendered as body. */}
              <Text style={{ ...styles.heading, fontSize: 16, color: color.ink }}>
                {rule.title}
              </Text>
              <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
                {rule.body}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Field
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder="Their name"
        maxLength={60}
        returnKeyType="done"
        accessibilityLabel="The child’s name"
        style={{ marginTop: space.xl }}
      />

      <Trouble message={trouble} />

      <View style={{ marginTop: space.xl, gap: size.stack }}>
        {/* The contract is above the button, not behind a checkbox: §4's compliance note
            wants consent inherent in the act, and a checkbox is something to click past. */}
        <Button
          label={create.isPending ? 'Adding…' : 'Add them'}
          variant="primary"
          disabled={create.isPending}
          onPress={submit}
        />
        <Button
          label="Not now"
          variant="text"
          disabled={create.isPending}
          onPress={() => leaveTo({ pathname: '/family/[id]', params: { id: id ?? '' } })}
        />
      </View>
    </FormScreen>
  );
}
