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
 * SecureStore has a 2048-byte value limit and no web implementation. A Supabase session
 * fits comfortably; the web fallback exists so `expo start --web` runs during development
 * and is not a supported target.
 */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(url, anonKey, {
  auth: {
    ...(Platform.OS === 'web' ? {} : { storage: secureStorage }),
    autoRefreshToken: true,
    persistSession: true,
    // There is no browser to hand the URL back, so the deep-link handler does it (§4.5).
    detectSessionInUrl: false,
  },
});
