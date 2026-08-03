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

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { useCreateManagedMember } from '../../lib/queries/managed';
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
    body: 'Their name and face never leave it. Year-end exports are numbers only — no photos, nobody named.',
  },
  {
    title: 'It moves with them',
    body: 'When they get a phone of their own, the whole profile transfers — same board, same year, dot removed.',
  },
] as const;

export default function AddChild() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const create = useCreateManagedMember(id ?? '');

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      const message = 'What should we call them?';
      setTrouble(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setTrouble(null);
    create.mutate(trimmed, {
      onSuccess: () => router.back(),
      onError: (e) => {
        const message = /full/i.test(e instanceof Error ? e.message : '')
          ? // A child takes a seat like anyone else (§4.5 of the PRD).
            'This Family is full for now. A child takes a seat like anyone else.'
          : 'That didn’t save. Have another go in a moment.';
        setTrouble(message);
        AccessibilityInfo.announceForAccessibility(message);
      },
    });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingTop: size.screenTop }}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
          Add a child
        </Text>
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
          They play through your account — no email, no password, nothing for them to
          forget.
        </Text>

        <View style={{ marginTop: space.xl, gap: space.lg }}>
          {CONTRACT.map((rule) => (
            <View key={rule.title} style={{ flexDirection: 'row', gap: space.md }}>
              {/* Clay means family, and this is the most family thing in the app (§1.1). */}
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{
                  width: 7,
                  height: 7,
                  marginTop: 8,
                  borderRadius: radius.pill,
                  backgroundColor: color.clay,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ ...styles.body, color: color.ink, fontWeight: undefined }}>
                  {rule.title}
                </Text>
                <Text style={{ ...styles.label, color: color.ink2, marginTop: space.xs }}>
                  {rule.body}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          placeholder="Their name"
          placeholderTextColor={color.ink3}
          maxLength={60}
          returnKeyType="done"
          accessibilityLabel="The child’s name"
          style={{
            ...styles.body,
            height: size.control,
            marginTop: space.xl,
            paddingHorizontal: space.md,
            color: color.ink,
            backgroundColor: color.paperRaised,
            borderWidth: 1,
            borderColor: color.hairline,
            borderRadius: radius.card,
          }}
        />

        {trouble === null ? null : (
          <Text
            accessibilityLiveRegion="polite"
            style={{ ...styles.body, color: color.ink2, marginTop: space.md }}
          >
            {trouble}
          </Text>
        )}

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
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
