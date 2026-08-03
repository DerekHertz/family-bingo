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
    let live = true;

    // onAuthStateChange fires INITIAL_SESSION immediately, and getSession() can resolve
    // after it — so the slower answer would overwrite the newer one. Once a subscription
    // event has been seen, the initial read is stale by definition and is dropped.
    let sawEvent = false;

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!live) return;
      sawEvent = true;
      setSession(next);
    });

    void supabase.auth.getSession().then(({ data: read }) => {
      if (!live || sawEvent) return;
      setSession(read.session);
    });

    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return session;
}
