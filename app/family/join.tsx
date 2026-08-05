/**
 * Join a Family — Slice 3 (PRD §3, FRONTEND_DESIGN §4.5).
 *
 * > **Join** — the 5×5 mark, one sentence naming the inviter and the Family, the faces
 * > already in it, 56pt `moss` join, "Not now" as a text row.
 *
 * The faces and the inviter's name are deliberately NOT shown before redeeming. §3.2 makes
 * a pending Member unable to read anything — not the Feed, not Boards, not other Members'
 * names — and that is a hard RLS boundary rather than a UI state. Rendering a preview
 * would mean handing a Family's roster to whoever holds a forwarded link, which is exactly
 * what the two gates exist to prevent. The screen names them AFTER the code is accepted
 * and the Organizer has let them in.
 *
 * Every failure says the same thing on purpose (api.md §9): expired, used, revoked and
 * never-real are indistinguishable, or the screen becomes an oracle for probing which
 * codes exist.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { leaveTo } from '../../lib/leave';
import { BoardMark } from '../../components/BoardMark';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { FormScreen, Trouble } from '../../components/Screen';
import { useAnnounce } from '../../lib/announce';
import { codeProblem, normalizeCode, useRedeemInvitation } from '../../lib/queries/invitations';
import { styles } from '../../theme/fonts';
import { color, size, space } from '../../theme/tokens';

export default function JoinFamily() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  const { trouble, say, clear } = useAnnounce();
  const redeem = useRedeemInvitation();

  const submit = () => {
    const problem = codeProblem(code);
    if (problem !== null) {
      say(problem);
      return;
    }
    clear();
    redeem.mutate(code, {
      onSuccess: () => setWaiting(true),
      // One message for every rejection. See the note at the top of this file.
      onError: () => say('That invitation has expired — ask for a new one.'),
    });
  };

  if (waiting) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: color.paper,
          padding: space.xl,
          justifyContent: 'center',
        }}
      >
        <BoardMark />
        <Text
          accessibilityRole="header"
          style={{ ...styles.title, color: color.ink, marginTop: space.xl }}
        >
          You&rsquo;re on the list
        </Text>
        {/* §3.3: the Organizer decides. Stated as a fact, with no estimate attached —
            "shortly" would be a promise this screen cannot keep. */}
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
          Someone in the Family has to let you in. You&rsquo;ll see their board once they do.
        </Text>
        <Button
          label="Back to your families"
          variant="text"
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
          onPress={() => router.replace('/home')}
        />
      </View>
    );
  }

  return (
    <FormScreen centred>
      <BoardMark />

      <Text
        accessibilityRole="header"
        style={{ ...styles.display, color: color.ink, marginTop: space.lg }}
      >
        Join a Family
      </Text>
      <Text
        style={{
          ...styles.body,
          color: color.ink2,
          marginTop: space.sm,
          textAlign: 'center',
          maxWidth: size.proseWidth,
        }}
      >
        Type the code you were given. Eight characters, and it doesn&rsquo;t matter how you
        space them.
      </Text>

      <View style={{ width: '100%', maxWidth: size.formWidth, marginTop: space.xl, gap: size.stack }}>
        <Field
          value={code}
          onChangeText={(next) => setCode(normalizeCode(next))}
          onSubmitEditing={submit}
          placeholder="ABCD2345"
          autoCapitalize="characters"
          autoCorrect={false}
          // No maxLength: RN truncates BEFORE onChangeText, so pasting "ABCD-2345" —
          // which the copy above explicitly invites — arrived as seven characters and
          // was rejected for being the wrong length. normalizeCode strips the dash.
          returnKeyType="done"
          accessibilityLabel="Invitation code"
          style={{ textAlign: 'center', letterSpacing: 4.8 }}
        />
        <Button
          label={redeem.isPending ? 'Checking…' : 'Join'}
          variant="primary"
          disabled={redeem.isPending}
          onPress={submit}
        />
        <Button
          label="Not now"
          variant="text"
          disabled={redeem.isPending}
          onPress={() => leaveTo('/home')}
        />
      </View>

      <Trouble
        message={trouble}
        style={{ marginTop: space.lg, textAlign: 'center', maxWidth: size.formWidth }}
      />
    </FormScreen>
  );
}
