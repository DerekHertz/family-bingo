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
import { Text, View } from 'react-native';
import { leaveTo } from '../../lib/leave';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { FormScreen, Trouble } from '../../components/Screen';
import { useAnnounce } from '../../lib/announce';
import { FAMILY_NAME, familyNameProblem, useCreateFamily } from '../../lib/queries/families';
import { styles } from '../../theme/fonts';
import { color, size, space } from '../../theme/tokens';

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
  // Both branches below used to expand `setTrouble` + `announceForAccessibility` by hand,
  // which is how a screen ends up saying one of its two failures silently (§6 A6).
  const { trouble, say, clear } = useAnnounce();
  const create = useCreateFamily();

  const submit = () => {
    const problem = familyNameProblem(name);
    if (problem !== null) {
      say(problem);
      return;
    }
    clear();
    create.mutate(
      { name, timezone: deviceTimezone() },
      {
        onSuccess: () => router.replace('/home'),
        onError: () => say('That didn’t save. Have another go in a moment.'),
      },
    );
  };

  return (
    <FormScreen>
      <Text accessibilityRole="header" style={{ ...styles.display, color: color.ink }}>
        Name your Family
      </Text>
      <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
        Everyone you invite will see this.
      </Text>

      <Field
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder="The Smith Family"
        maxLength={FAMILY_NAME.max}
        returnKeyType="done"
        // No autoFocus: it yanks VoiceOver past the header, so the one sentence saying
        // what the screen is for is never read (§6). The field is the only control here
        // and a sighted Member reaches it in one tap.
        accessibilityLabel="Family name"
        style={{ marginTop: space.xl }}
      />

      <Trouble message={trouble} />

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
          onPress={() => leaveTo('/home')}
        />
      </View>
    </FormScreen>
  );
}
