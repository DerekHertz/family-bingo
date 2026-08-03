import { defineConfig } from 'vitest/config';

/**
 * The pure layers: domain logic, geometry, and the theme's own invariants. No renderer, no
 * Docker, no network — this suite runs in milliseconds and is the one that gates commits.
 *
 * `app/` and `components/` are deliberately absent as test *locations* but ARE read by
 * theme/fonts.test.ts, which greps them for a mistake a type checker cannot see.
 * Integration tests live in supabase/tests/integration and have their own config.
 */
export default defineConfig({
  test: {
    include: ['{src,theme,lib}/**/*.test.ts'],
  },
});
