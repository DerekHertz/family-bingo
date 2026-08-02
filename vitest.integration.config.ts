import { defineConfig } from 'vitest/config';

/**
 * Integration tests, kept out of `npm test` on purpose.
 *
 * `npm test` is the pure domain layer: no Docker, no network, milliseconds. These need
 * the local stack running (`npm run db:start`) and talk to it over HTTP, which is the
 * whole point — §16.5 is a claim about what a real Storage endpoint returns, and nothing
 * that stubs Storage can settle it.
 */
export default defineConfig({
  test: {
    include: ['supabase/tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
