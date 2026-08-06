/**
 * The persisted query cache (PRD §17.5).
 *
 * > Board and Feed cached read-only so the app opens to content rather than a spinner.
 *
 * `@tanstack/react-query`'s first-party persistence, wired to the same AsyncStorage the
 * offline queue uses. The *policy* — which queries are allowed on a disk at all — is
 * `lib/persist-policy.ts`, kept separate so it can be tested without a native module.
 *
 * **Three things this must not undo**, all of them privacy controls that already exist:
 *
 *   1. **Every query key carries the Account id.** That is what stops one Account being
 *      served the previous one's rows out of a cache that outlives a sign-in. It keeps
 *      working here — a restored cache is keyed the same way, so a different Account's
 *      queries simply miss — but "keyed so it cannot be *read*" is a weaker property than
 *      "not on the disk at all" once the cache is a file rather than a heap.
 *   2. **`SIGNED_OUT` clears the cache.** It now has to clear the *file* too, or the app
 *      restores the previous Account's Board on the next launch and holds it in memory,
 *      unreadable by the new Account and undeletable by anyone. `app/_layout.tsx` calls
 *      `removeClient()` alongside `queryClient.clear()` for exactly that.
 *   3. **A photo never reaches a disk** (§7.6). `shouldPersistKey` denies by default and
 *      excludes `photo-urls` by name.
 *
 * **Mutations are never persisted.** react-query can rehydrate paused mutations and replay
 * them, and this app already has something that replays taps: `lib/queue.ts`. Two replay
 * mechanisms for the same write is how one tap becomes two — and only one of them holds
 * the `occurred_at` the tap actually happened at (§17.3).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery } from '@tanstack/react-query';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { Platform } from 'react-native';
import { shouldPersistKey } from './persist-policy';

/**
 * Versioned in the name, like the queue's key.
 *
 * The shape of what is cached changes with every slice. A rename here is a clean slate
 * rather than a migration, and the cost of a clean slate is one spinner.
 */
const CACHE_KEY = 'family-bingo.query-cache.v1';

/**
 * How stale a restored cache may be before it is thrown away rather than shown.
 *
 * A day. §17.5 is about opening to *content*, and a Board from this morning is content;
 * a Board from three weeks ago is a museum piece that would show a Member counts they have
 * since changed on another handset. Everything restored is refetched anyway — `staleTime`
 * is a minute — so this bound is about what is worth rendering for the second before the
 * network answers.
 */
const MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Bumped by hand when the persisted shape changes incompatibly. react-query discards a
 * cache whose buster does not match, which is the cheap way to avoid ever hydrating a
 * Board written by a build that thought about Tiles differently.
 */
const BUSTER = 'slice-17';

/**
 * **Nothing is written to disk in a browser.**
 *
 * On web `AsyncStorage` *is* `localStorage`, so leaving this on would put Boards, goal
 * text, Feed rows and Member names into the same origin storage a stolen session already
 * worries us — and unlike the session, none of it is short-lived or rotated. §17.5 asks
 * for this so a phone opens to content instead of a spinner on a train; a browser tab is
 * a different situation and does not need it enough to pay for it.
 *
 * A no-op store rather than a conditional provider, so the tree shape is the same on both
 * platforms and there is exactly one place that decides.
 */
const noStore = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
};

export const persister = createAsyncStoragePersister({
  storage: Platform.OS === 'web' ? noStore : AsyncStorage,
  key: CACHE_KEY,
  // The Feed's paging writes to the cache on every scroll. Two seconds of throttle keeps
  // a long scroll from turning into a hundred file writes.
  throttleTime: 2_000,
});

export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister,
  maxAge: MAX_AGE,
  buster: BUSTER,
  dehydrateOptions: {
    /**
     * The allowlist, and react-query's own rule that only a *successful* query is worth
     * keeping — a persisted error would open the app to a failure that happened yesterday.
     */
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) && shouldPersistKey(query.queryKey),
    shouldDehydrateMutation: () => false,
  },
};
