/**
 * Going back, from a screen that might have been arrived at directly.
 *
 * `router.back()` alone assumes there is a history to pop, and on every screen in this
 * app that assumption can be false:
 *
 *   - **On web**, any route can be the first one. Typing `/board/<id>` into the address
 *     bar, reloading, or following a link opens that screen with an empty stack.
 *   - **On device**, a deep link does the same — and the magic link in slice 1 is
 *     literally a deep link, so this is the ordinary way somebody arrives after signing
 *     in on their phone.
 *   - **After a save**, `router.back()` runs when the screen may already have been popped.
 *
 * In all three, expo-router logs *"The action 'GO_BACK' was not handled by any navigator.
 * Is there any screen to go back to?"* and the Member is stranded on a screen whose only
 * exit does nothing.
 *
 * So every "Back" says where back *is*. `dismissTo` rather than `replace`: if the target
 * is already somewhere in the stack it unwinds to it, and only replaces when it is not —
 * which keeps the history honest instead of growing a new entry each time.
 */

import { type Href, router } from 'expo-router';

/**
 * Leave this screen for `fallback` if there is nothing to go back to.
 *
 * The fallback is not decoration: it is the answer to "what is this screen *inside* of",
 * and every caller has one. A Goal is inside a Board; a Board and the Centre are inside a
 * Family; a Family is inside home.
 */
export const leaveTo = (fallback: Href): void => {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.dismissTo(fallback);
};
