/**
 * The one Supabase client.
 *
 * Session tokens go in `expo-secure-store` (api.md §1), not AsyncStorage: the keychain is
 * the only place on a handset where a token is protected from another app reading it, and
 * a session here is the whole of a Family's boundary (ADR-0004).
 *
 * The anon key is public by design — it authorizes nothing on its own; RLS decides every
 * row. The service role key must never appear in this bundle, or in any file it imports.
 */

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (url === undefined || anonKey === undefined) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env',
  );
}

/**
 * SecureStore refuses values over 2048 bytes, and a persisted session goes well past it:
 * two JWTs plus the whole user object, including `identities[].identity_data` — name,
 * email, avatar URL — which Google and Apple both populate. Typical is 2.5-4 KB.
 *
 * supabase-js swallows storage errors, so the failure mode was silent and perfectly
 * plausible: sign in, everything works, relaunch, signed out again, forever. It is the
 * kind of bug that gets blamed on the auth provider.
 *
 * So the value is split across numbered keys. Key 0 holds the chunk count, which is what
 * lets a read know how many to fetch and a write know how many stale ones to clear.
 */
const CHUNK = 1800; // under 2048 with room for the key name and encoding overhead

const chunkedStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const count = await SecureStore.getItemAsync(`${key}.n`);
    if (count === null) return SecureStore.getItemAsync(key); // written before chunking
    const parts = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)),
    );
    return parts.some((p) => p === null) ? null : parts.join('');
  },

  setItem: async (key: string, value: string): Promise<void> => {
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [''];
    // Clear a longer previous write first, or its tail survives and a later read
    // reassembles two sessions spliced together.
    const previous = await SecureStore.getItemAsync(`${key}.n`);
    for (let i = parts.length; i < Number(previous ?? 0); i += 1) {
      await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
    await Promise.all(parts.map((part, i) => SecureStore.setItemAsync(`${key}.${i}`, part)));
    await SecureStore.setItemAsync(`${key}.n`, String(parts.length));
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  },

  removeItem: async (key: string): Promise<void> => {
    const count = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)),
    );
    await SecureStore.deleteItemAsync(`${key}.n`);
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Where a browser keeps the session, and why it is `sessionStorage`.
 *
 * There is no keychain in a browser. The refresh token has to live in `localStorage` or
 * `sessionStorage` — both readable by any script that runs on this origin — or in memory,
 * which drops the session on every refresh. An httpOnly cookie is the only option that
 * removes the risk outright, and it needs a server this app does not have.
 *
 * So the question is not "can a script read it" (yes, in every option here) but "for how
 * long is it there to be read". `sessionStorage` is scoped to the tab: close it and the
 * token is gone. That defeats the one attack the app can actually defend against — someone
 * opening a laptop that was left signed in — and narrows the window for the two it cannot
 * (an injected script, a malicious extension).
 *
 * **What makes this defensible rather than merely cheap** is that the origin is a small
 * target. The app renders no HTML from user input: every Goal, note and name goes through
 * React Native Web's `<Text>`, which escapes, and there is no `dangerouslySetInnerHTML`,
 * no markdown, no WebView, no third-party script. The realistic path in is a compromised
 * dependency, which is why the lockfile is watched. And a stolen token is bounded by RLS
 * to one Account's own Family — it is not a key to a database (ADR-0004).
 *
 * **The cost is real and per-tab.** A second tab is a signed-out tab; a link opened from a
 * message is a new tab. That is why `WEB_SESSION_PERSISTS` exists: flipping it to `true`
 * moves the token to `localStorage`, which survives tabs and restarts at the price of
 * surviving the walk-away too. It is one line because the trade is a product decision the
 * first round of family testing should settle, not an architectural one.
 */
const WEB_SESSION_PERSISTS = false;

const webStore = (): Storage | undefined =>
  WEB_SESSION_PERSISTS ? globalThis.localStorage : globalThis.sessionStorage;

const webStorage = {
  getItem: (key: string) => Promise.resolve(webStore()?.getItem(key) ?? null),
  setItem: (key: string, value: string) => {
    webStore()?.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    webStore()?.removeItem(key);
    return Promise.resolve();
  },
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : chunkedStorage,
    autoRefreshToken: true,
    persistSession: true,
    /**
     * **On web, let supabase-js read the URL it was redirected back to.**
     *
     * The two platforms hand a session back by different routes and only one of them has
     * a browser to be redirected *in*. On a device there is nothing to detect — the OS
     * hands the app a deep link, and `app/auth/callback.tsx` plus the `Linking` listener
     * in `lib/auth.ts` parse it explicitly. In a browser the provider redirects the page
     * itself, and the tokens arrive in the URL of the document that is already loading;
     * detecting them is the whole handoff, and doing it by hand would be reimplementing
     * what the library does correctly, including clearing them out of the address bar
     * afterwards so they do not sit in history.
     */
    detectSessionInUrl: Platform.OS === 'web',
    /**
     * PKCE on web, because the browser flow puts a code in a query string.
     *
     * The implicit flow returns tokens in the URL fragment, which never reaches a server
     * but does reach anything reading `location`. PKCE returns a short-lived code that is
     * useless without the verifier held in this tab — so an intercepted redirect is not a
     * session. Native keeps the default: the deep link never leaves the device.
     */
    flowType: Platform.OS === 'web' ? 'pkce' : 'implicit',
  },
});
