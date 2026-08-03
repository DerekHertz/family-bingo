import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The one architectural rule worth a test.
 *
 * `src/domain` is imported by the server's Edge Functions, by the client, and by a Vitest
 * suite that runs in milliseconds with no Docker and no network. All three depend on it
 * importing nothing but itself: one `react-native` import anywhere in here and the domain
 * suite stops running, the Edge Functions stop bundling, and the shared logic quietly
 * becomes client logic.
 *
 * It has already happened once. familyNameProblem() was written next to the query that
 * called it, so testing a pure string rule pulled in the Supabase client, expo-secure-store
 * and the whole React Native module graph — and the test could not even parse.
 */
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

/**
 * Every module specifier, however it is written.
 *
 * The first version matched `from '...'` and `import '...'` only, which let
 * `import('react-native')` and `require('react-native')` straight through — both break the
 * domain suite and the Edge bundle exactly as a static import would, and both are what
 * someone reaches for precisely when a static import has just been rejected.
 */
const importsOf = (file: string): string[] =>
  [
    ...readFileSync(file, 'utf8').matchAll(
      /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ].map((m) => m[1] as string);

describe('src/domain imports nothing but itself', () => {
  const sources = files('src').filter((f) => !/\.test\.tsx?$/.test(f));

  it('has files to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it.each(sources)('%s pulls in no runtime dependency', (file) => {
    const forbidden = importsOf(file).filter(
      (spec) =>
        // Relative imports stay inside src/ — anything climbing out is a layering break.
        (spec.startsWith('.') && spec.includes('../../')) ||
        // Everything else must be a bare node builtin at most. No react, no react-native,
        // no supabase, no expo.
        (!spec.startsWith('.') && !spec.startsWith('node:')),
    );
    expect(forbidden).toEqual([]);
  });
});

describe('the check itself has teeth', () => {
  // A rule nobody can see failing is a rule that quietly stops holding. These are the two
  // shapes that got past the first version of the matcher.
  const scan = (source: string) =>
    [
      ...source.matchAll(
        /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
      ),
    ].map((m) => m[1]);

  it('catches a static import', () => {
    expect(scan("import { View } from 'react-native';")).toContain('react-native');
  });

  it('catches a dynamic import', () => {
    expect(scan("const m = await import('react-native');")).toContain('react-native');
  });

  it('catches a require', () => {
    expect(scan("const m = require('react-native');")).toContain('react-native');
  });

  it('catches a side-effect import', () => {
    expect(scan("import 'react-native';")).toContain('react-native');
  });
});
