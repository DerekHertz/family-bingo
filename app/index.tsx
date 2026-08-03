/**
 * Sign in — Slice 1 (PRD §1, FRONTEND_DESIGN §4).
 *
 * Three passwordless routes and no password field anywhere. The footer is the promise the
 * screen is making, and it is load-bearing copy rather than decoration:
 *
 * > "No passwords. Not now, not later — there's nothing to forget."
 *
 * Nothing on this screen knows what a Family is. An Account is a login and only a login
 * (CONTEXT.md); where a Member goes next is slice 2's question.
 */

import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../components/Button';
import { BoardMark } from '../components/BoardMark';
import { signInWithEmail, signInWithProvider, type Provider } from '../lib/auth';
import { useSession } from '../lib/session';
import { text } from '../theme/fonts';
import { color, radius, space, type } from '../theme/tokens';

export default function SignIn() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [busy, setBusy] = useState<Provider | 'email' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Never `red`, never the word "error" (§1.1, §0.3). Plain words in ink2.
  const [trouble, setTrouble] = useState<string | null>(null);

  // `undefined` means the keychain is still being read. Rendering the screen during that
  // would flash it at every Member who is already signed in.
  if (session === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator color={color.ink3} />
      </View>
    );
  }
  if (session !== null) return <Redirect href="/home" />;

  const attempt = async (who: Provider | 'email', run: () => Promise<void>) => {
    setBusy(who);
    setTrouble(null);
    try {
      await run();
    } catch {
      // Nothing scolds (§0.3). The Member is told what happened and what to do, once.
      setTrouble('That didn’t go through. Have another go in a moment.');
    } finally {
      setBusy(null);
    }
  };

  if (sentTo !== null) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, justifyContent: 'center' }}>
        <BoardMark />
        <Text style={{ ...text(type.title), color: color.ink, marginTop: space.xl }}>
          Check your email
        </Text>
        <Text style={{ ...text(type.body), color: color.ink2, marginTop: space.sm }}>
          We sent a link to {sentTo}. Opening it on this phone signs you in.
        </Text>
        <Button
          label="Use a different address"
          variant="text"
          onPress={() => setSentTo(null)}
          style={{ marginTop: space.lg, alignItems: 'flex-start' }}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <BoardMark />

        <Text
          accessibilityRole="header"
          style={{
            ...text(type.display),
            fontSize: 38,
            lineHeight: 44,
            color: color.ink,
            marginTop: space.lg,
          }}
        >
          Family Bingo
        </Text>

        <View style={{ width: '100%', maxWidth: 340, marginTop: space.xxl, gap: 10 }}>
          {showEmail ? (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={color.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                accessibilityLabel="Email address"
                style={{
                  ...text(type.body),
                  height: 52,
                  paddingHorizontal: space.md,
                  color: color.ink,
                  backgroundColor: color.paperRaised,
                  borderWidth: 1,
                  borderColor: color.hairline,
                  borderRadius: radius.card,
                }}
              />
              <Button
                label={busy === 'email' ? 'Sending…' : 'Send me a link'}
                variant="filled"
                disabled={busy !== null || email.trim().length === 0}
                onPress={() =>
                  void attempt('email', async () => {
                    await signInWithEmail(email);
                    setSentTo(email.trim());
                  })
                }
              />
            </>
          ) : (
            <>
              <Button
                label="Continue with Apple"
                variant="filled"
                disabled={busy !== null}
                onPress={() => void attempt('apple', () => signInWithProvider('apple'))}
              />
              <Button
                label="Continue with Google"
                disabled={busy !== null}
                onPress={() => void attempt('google', () => signInWithProvider('google'))}
              />
              <Button
                label="Email me a link instead"
                variant="text"
                disabled={busy !== null}
                onPress={() => setShowEmail(true)}
              />
            </>
          )}
        </View>

        {trouble === null ? null : (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              ...text(type.body),
              color: color.ink2,
              marginTop: space.lg,
              textAlign: 'center',
              maxWidth: 340,
            }}
          >
            {trouble}
          </Text>
        )}

        <Text
          style={{
            ...text(type.label),
            color: color.ink2,
            marginTop: space.xxl,
            textAlign: 'center',
            maxWidth: 300,
          }}
        >
          No passwords. Not now, not later — there&rsquo;s nothing to forget.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
