/**
 * Every `supabase.rpc()` call site names arguments the migrations actually declare.
 *
 * This exists because the mistake it catches is invisible until runtime and then looks
 * like something else entirely. PostgREST resolves an RPC **by argument name**: get one
 * wrong and the answer is PGRST202, "could not find the function `public.foo(a, b)` in
 * the schema cache" — which reads as "the migration was never deployed", not "you have a
 * typo". `tsc` cannot see it, and neither can pgTAP, which calls the same functions in
 * SQL where the names are right.
 *
 * It has bitten twice. `write_goal` was replaced by a later migration and every call site
 * had to be re-checked by hand; `consume_sharpen` renamed its parameters to `target_*`
 * (so `ON CONFLICT` would stop binding bare column names to them) and the `sharpen` Edge
 * Function was never updated — so every successful Sharpening call came back PGRST202,
 * was swallowed as a spent budget, and threw away the suggestion it had just paid for.
 * Sharpening returned nothing, for anyone, and the rate limit never incremented.
 *
 * Pure and fast: it reads the SQL and the call sites off disk and compares strings. No
 * database, no network.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

/** Files that may call an RPC: the client's query layer and the Edge Functions. */
const callSiteFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return callSiteFiles(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
    });
  } catch {
    return [];
  }
};

/**
 * Every function the migrations declare, as name -> the argument names it accepts.
 *
 * Migrations are read in filename order and a later `create or replace` overwrites an
 * earlier one, because that is exactly what Postgres does — and it is the half of this
 * that a reader is most likely to get wrong. `write_goal` is declared twice.
 */
const declaredSignatures = (): Map<string, Set<string>> => {
  const dir = join(root, 'supabase', 'migrations');
  const signatures = new Map<string, Set<string>>();

  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    // The parameter list runs to the closing paren before `returns`. Non-greedy so a
    // later function in the same file cannot be swallowed.
    const pattern = /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const [, name, params] of sql.matchAll(pattern)) {
      if (name === undefined || params === undefined) continue;
      const args = new Set<string>();
      for (const raw of params.split(',')) {
        // "unit text default null" -> "unit". An empty parameter list yields nothing.
        const first = raw.trim().split(/\s+/)[0];
        if (first !== undefined && first !== '' && /^\w+$/.test(first)) args.add(first);
      }
      signatures.set(name.toLowerCase(), args);
    }
  }
  return signatures;
};

/** Every `supabase.rpc('name', { a: …, b: … })` in the tree, with the keys it passes. */
const callSites = (): { file: string; fn: string; args: string[] }[] => {
  const files = [
    ...callSiteFiles(join(root, 'lib')),
    ...callSiteFiles(join(root, 'app')),
    ...callSiteFiles(join(root, 'supabase', 'functions')),
  ];

  const found: { file: string; fn: string; args: string[] }[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const pattern = /\.rpc\(\s*'([\w]+)'\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g;
    for (const [, fn, body] of source.matchAll(pattern)) {
      if (fn === undefined) continue;
      const args =
        body === undefined
          ? []
          : // Object keys only — the left of each top-level colon. Values can contain
            // colons of their own (a ternary), so anchor on a separator.
            [...body.matchAll(/(?:^|[,{])\s*([A-Za-z_]\w*)\s*:/g)].flatMap((m) =>
              m[1] === undefined ? [] : [m[1]],
            );
      found.push({ file: file.slice(root.length + 1), fn, args });
    }
  }
  return found;
};

describe('every supabase.rpc() call matches a migration signature', () => {
  const signatures = declaredSignatures();
  const sites = callSites();

  it('finds the call sites at all — a silent zero would pass every assertion below', () => {
    expect(sites.length).toBeGreaterThan(5);
    expect(signatures.size).toBeGreaterThan(10);
  });

  it('names a function the migrations declare', () => {
    const unknown = sites.filter((s) => !signatures.has(s.fn.toLowerCase()));
    expect(unknown.map((s) => `${s.file}: ${s.fn}()`)).toEqual([]);
  });

  it('passes only arguments that function accepts', () => {
    const wrong: string[] = [];
    for (const site of sites) {
      const declared = signatures.get(site.fn.toLowerCase());
      if (declared === undefined) continue;
      for (const arg of site.args) {
        if (!declared.has(arg)) {
          wrong.push(
            `${site.file}: ${site.fn}({ ${arg}: … }) — accepts ${[...declared].join(', ')}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('knows about the two functions this guard was written for', () => {
    // A canary on the parser itself. If a migration is reformatted in a way this regex
    // cannot read, every assertion above passes vacuously — these two fail loudly first.
    expect(signatures.get('write_goal')).toContain('unit_canonical');
    expect(signatures.get('consume_sharpen')).toContain('target_member_id');
  });
});
