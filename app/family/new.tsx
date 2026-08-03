/**
 * Create a Family — Slice 2 (PRD §2, FRONTEND_DESIGN §4.5).
 *
 * > **Create** — one field. Name only; year, timezone and board size are product
 * > decisions, not a form.
 *
 * The timezone is taken from the handset rather than asked for. It is a real decision —
 * §8.3 T1 hangs every deadline, Freeze and Digest off it — but it is one the phone already
 * knows the answer to, and asking would be a form field that exists to make the software's
 * job easier. The Organizer can move it later in Account.
 */

import { useRouter } from 'expo-router';
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
import { FAMILY_NAME, familyNameProblem, useCreateFamily } from '../../lib/queries/families';
import { styles } from '../../theme/fonts';
import { color, radius, size, space } from '../../theme/tokens';

/** What the handset thinks it is, which is what §8.3 T1 wants. */
const deviceTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export default function NewFamily() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const create = useCreateFamily();

  const submit = () => {
    const problem = familyNameProblem(name);
    if (problem !== null) {
      setTrouble(problem);
      AccessibilityInfo.announceForAccessibility(problem);
      return;
    }
    setTrouble(null);
    create.mutate(
      { name, timezone: deviceTimezone() },
      {
        onSuccess: () => router.replace('/home'),
        onError: () => {
          const message = 'That didn’t save. Have another go in a moment.';
          setTrouble(message);
          AccessibilityInfo.announceForAccessibility(message);
        },
      },
    );
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
          Name your Family
        </Text>
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
          Everyone you invite will see this.
        </Text>

        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          placeholder="The Smith Family"
          placeholderTextColor={color.ink3}
          maxLength={FAMILY_NAME.max}
          returnKeyType="done"
          // No autoFocus: it yanks VoiceOver past the header, so the one sentence saying
          // what the screen is for is never read (§6). The field is the only control here
          // and a sighted Member reaches it in one tap.
          accessibilityLabel="Family name"
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
          <Button
            label={create.isPending ? 'Creating…' : 'Create it'}
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
