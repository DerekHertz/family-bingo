/**
 * The current session, as a hook.
 *
 * `undefined` while the stored session is still being read from the keychain, and `null`
 * once it is known there isn't one. The distinction matters: rendering the sign-in screen
 * during that read would flash it at every Member who is already signed in.
 */

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return session;
}
