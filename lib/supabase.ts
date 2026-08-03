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
 * Web persists to `localStorage`, and that is a development decision rather than a
 * security one.
 *
 * There is no keychain in a browser, so the only choices are localStorage — readable by
 * any script on the origin — or memory, which drops the session on every refresh. This
 * shipped as memory first, and it made the app unusable to develop against: create a
 * Family, refresh, and you are back at sign-in with a rate-limited magic link as the only
 * way back in.
 *
 * Web is explicitly not a shipping target (§0, "Platform: Expo (iOS + Android)"). Against
 * a localhost dev server the "any script on the origin" threat is the developer's own
 * bundle. If web ever becomes a real target this has to be revisited, which is why it
 * fails loudly rather than quietly if that day comes without anyone noticing.
 */
const webStorage = {
  getItem: (key: string) => Promise.resolve(globalThis.localStorage?.getItem(key) ?? null),
  setItem: (key: string, value: string) => {
    globalThis.localStorage?.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    globalThis.localStorage?.removeItem(key);
    return Promise.resolve();
  },
};

/**
 * The rationale is "against a localhost dev server the threat is the developer's own
 * bundle", so the guard has to be localhost — not NODE_ENV.
 *
 * `expo start --tunnel`, a LAN IP, and any preview deployment are all NODE_ENV
 * development, and every one of them is a shared origin where two JWTs in localStorage is
 * exactly what §16.2 rules out. Checking the build mode let all three through.
 */
if (Platform.OS === 'web') {
  const host = globalThis.location?.hostname ?? '';
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocalhost) {
    throw new Error(
      `Web is a localhost development target only. This origin is "${host}", where session ` +
        'storage would be localStorage — not acceptable for anything reachable by another ' +
        'machine. Revisit lib/supabase.ts before serving web from anywhere but localhost.',
    );
  }
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : chunkedStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no browser to hand the URL back on a device, so app/auth/callback.tsx and
    // the Linking listener in lib/auth.ts do it explicitly.
    detectSessionInUrl: false,
  },
});
