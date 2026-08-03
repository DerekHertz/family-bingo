import { type } from './tokens';

/**
 * The loaded font family names.
 *
 * @expo-google-fonts exposes each weight as its own family, so `type` in tokens.ts names
 * the family and this maps it to what the renderer actually has. Keeping the mapping here
 * lets tokens.ts stay a pure description of the design system (§1).
 */

export const loaded = {
  display: 'ShipporiMincho_500Medium',
  ui400: 'ZenKakuGothicNew_400Regular',
  ui500: 'ZenKakuGothicNew_500Medium',
  ui700: 'ZenKakuGothicNew_700Bold',
} as const;

/** Resolve a token's family + weight to the concrete loaded face. */
export const face = (family: string, weight?: string): string => {
  if (family === 'ShipporiMincho') return loaded.display;
  if (weight === '700') return loaded.ui700;
  if (weight === '500') return loaded.ui500;
  return loaded.ui400;
};

/**
 * A `type` token as a style the renderer can use.
 *
 * `fontWeight` is dropped deliberately. With a bundled face the weight is already in the
 * family name, and leaving it set makes both platforms synthesise a second bold on top of
 * a face that already has one — the smeared text that gives away a rushed font setup.
 */
export const text = <T extends { fontFamily: string; fontWeight?: string }>(token: T) => {
  const { fontWeight, ...rest } = token;
  return { ...rest, fontFamily: face(token.fontFamily, fontWeight) };
};

/**
 * Every `type` token, pre-resolved. **Use these, not the raw tokens.**
 *
 * Spreading `type.body` directly is a silent bug: it carries the design system's family
 * name (`ZenKakuGothicNew`), which is not a face the renderer has loaded, so the text
 * falls back to the system font and nothing warns you. It shipped that way in the first
 * button written against these tokens.
 *
 * `tokens.ts` stays a pure description of the design system (§1); this is the only place
 * that knows what @expo-google-fonts actually registered.
 */
export const styles = {
  display: text(type.display),
  title: text(type.title),
  cardHead: text(type.cardHead),
  heading: text(type.heading),
  body: text(type.body),
  label: text(type.label),
  meta: text(type.meta),
} as const;
