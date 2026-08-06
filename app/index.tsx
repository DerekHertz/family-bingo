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
import { Platform, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { BoardMark } from '../components/BoardMark';
import { Field } from '../components/Field';
import { FormScreen, Loading, Trouble } from '../components/Screen';
import { useAnnounce } from '../lib/announce';
import {
  DevLoginUnavailable,
  NoSuchAccount,
  ProviderNotEnabled,
  SignInCancelled,
  devLoginSecret,
  signInWithEmail,
  signInWithProvider,
  signInWithoutEmail,
  type Provider,
} from '../lib/auth';
import { useSession } from '../lib/session';
import { styles } from '../theme/fonts';
import { color, size, space } from '../theme/tokens';

/**
 * Which sign-in routes this build can actually complete.
 *
 * Web is the deployed target and has exactly one working door — see the comment beside
 * the buttons. A constant rather than a runtime probe of `/auth/v1/settings`, because the
 * two things missing are missing for reasons no endpoint reports: Apple needs a paid
 * programme, and the magic link needs a domain that has not been bought yet.
 */
const WEB_SIGN_IN_IS_GOOGLE_ONLY = Platform.OS === 'web';

export default function SignIn() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [busy, setBusy] = useState<Provider | 'email' | 'dev' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Never `red`, never the word "error" (§1.1, §0.3). Plain words in ink2.
  const { trouble, say, clear } = useAnnounce();

  // `undefined` means the keychain is still being read. Rendering the screen during that
  // would flash it at every Member who is already signed in.
  if (session === undefined) return <Loading what="Checking whether you are signed in" />;
  if (session !== null) return <Redirect href="/home" />;

  const attempt = async (who: Provider | 'email' | 'dev', run: () => Promise<void>) => {
    setBusy(who);
    clear();
    try {
      await run();
    } catch (e) {
      // Backing out of the provider sheet is a decision, not a failure. Saying "that
      // didn't go through" to someone who deliberately closed it is exactly the scolding
      // §0.3 rules out.
      if (e instanceof SignInCancelled) return;
      const message =
        e instanceof ProviderNotEnabled
          ? // Retrying cannot fix this, so the copy must not suggest it. Points at the one
            // route that needs no provider configuration at all.
            `${e.provider === 'apple' ? 'Apple' : 'Google'} isn’t set up for this project yet — use the email link instead.`
          : e instanceof NoSuchAccount
            ? 'No account here with that address yet. Send yourself a link to make one.'
            : e instanceof DevLoginUnavailable
              ? 'Dev sign-in isn’t switched on for this project.'
              : e instanceof Error && e.message.startsWith('that does not look')
                ? 'That doesn’t look like an email address.'
                : 'That didn’t go through. Have another go in a moment.';
      // `say`, not `setTrouble`: accessibilityLiveRegion is Android-only, so iOS has to be
      // told outright or the one piece of feedback on this screen is silent (§6 A6).
      say(message);
    } finally {
      setBusy(null);
    }
  };

  if (sentTo !== null) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, padding: space.xl, justifyContent: 'center' }}>
        <BoardMark />
        <Text
          accessibilityRole="header"
          style={{ ...styles.title, color: color.ink, marginTop: space.xl }}
        >
          Check your email
        </Text>
        <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
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
    <FormScreen centred>
      <BoardMark />

      <Text
        accessibilityRole="header"
        style={{
          ...styles.display,
          ...size.wordmark,
          color: color.ink,
          marginTop: space.lg,
        }}
      >
        Family Bingo
      </Text>

      <View
        style={{
          width: '100%',
          maxWidth: size.formWidth,
          marginTop: space.xxl,
          gap: size.stack,
        }}
      >
        {showEmail ? (
          <>
            <Field
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              accessibilityLabel="Email address"
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
            {/* The development route (lib/auth.ts). Absent entirely unless this build
                was configured with EXPO_PUBLIC_DEV_LOGIN_SECRET, so it cannot appear in
                a real one — and quiet even then, because it is scaffolding rather than
                a fourth way to sign in. */}
            {devLoginSecret === undefined ? null : (
              <Button
                label={busy === 'dev' ? 'Signing in…' : 'Sign in without the email (dev)'}
                variant="text"
                disabled={busy !== null || email.trim().length === 0}
                onPress={() => void attempt('dev', () => signInWithoutEmail(email))}
              />
            )}

            {/* Choosing email was one tap; leaving has to be one too. Without this the
                only way out is to relaunch the app. */}
            <Button
              label="Other ways to sign in"
              variant="text"
              disabled={busy !== null}
              onPress={() => {
                setShowEmail(false);
                clear();
              }}
            />
          </>
        ) : (
          <>
            {/* **Only the doors that open.**
                §4 specifies three passwordless routes, and on a handset all three are
                reachable. The deployed web build is a different situation and the screen
                should say so by omission rather than by an error message:

                  - **Apple** needs the paid Developer Programme for a Service ID before it
                    will do web sign-in at all. It is not configured and is not going to be.
                  - **The magic link** needs an SMTP provider, which needs a domain. Until
                    one is bought, the built-in sender delivers to nobody but the project's
                    own team — so the button would send a family member away to wait for an
                    email that never arrives.

                Offering a control that answers "isn't set up for this project yet" is the
                §0.3 failure exactly: a retry that is guaranteed not to work. When the
                domain lands, `WEB_SIGN_IN` grows the magic link back. */}
            {WEB_SIGN_IN_IS_GOOGLE_ONLY ? null : (
              <Button
                label="Continue with Apple"
                variant="filled"
                disabled={busy !== null}
                onPress={() => void attempt('apple', () => signInWithProvider('apple'))}
              />
            )}
            <Button
              label="Continue with Google"
              variant={WEB_SIGN_IN_IS_GOOGLE_ONLY ? 'primary' : 'outlined'}
              disabled={busy !== null}
              onPress={() => void attempt('google', () => signInWithProvider('google'))}
            />
            {WEB_SIGN_IN_IS_GOOGLE_ONLY ? null : (
              <Button
                label="Email me a link instead"
                variant="text"
                disabled={busy !== null}
                onPress={() => setShowEmail(true)}
              />
            )}
          </>
        )}
      </View>

      {/* A live region as well as `say()`: the copy above can be set by a provider
          rejection nothing else announced, so this is the Android half of §6 A6. */}
      <Trouble
        message={trouble}
        style={{
          marginTop: space.lg,
          textAlign: 'center',
          maxWidth: size.formWidth,
        }}
      />

      <Text
        style={{
          ...styles.label,
          color: color.ink2,
          marginTop: space.xxl,
          textAlign: 'center',
          maxWidth: size.proseWidth,
        }}
      >
        No passwords. Not now, not later — there&rsquo;s nothing to forget.
      </Text>
    </FormScreen>
  );
}
