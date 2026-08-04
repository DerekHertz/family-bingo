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
interface Signature {
  /** Every parameter name the function accepts. */
  args: Set<string>;
  /** Those without a DEFAULT — omitting one is the same 404 as misspelling a name. */
  required: Set<string>;
}

const declaredSignatures = (): Map<string, Signature> => {
  const dir = join(root, 'supabase', 'migrations');
  const signatures = new Map<string, Signature>();

  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    // The parameter list runs to the closing paren before `returns`. Non-greedy so a
    // later function in the same file cannot be swallowed.
    const pattern = /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const [, name, params] of sql.matchAll(pattern)) {
      if (name === undefined || params === undefined) continue;
      const args = new Set<string>();
      const required = new Set<string>();
      for (const raw of params.split(',')) {
        // "unit text default null" -> "unit". An empty parameter list yields nothing.
        const first = raw.trim().split(/\s+/)[0];
        if (first === undefined || first === '' || !/^\w+$/.test(first)) continue;
        args.add(first);
        // A parameter with no DEFAULT must be supplied, or PostgREST cannot resolve the
        // function at all — the same 404 as a misspelled name, from the opposite mistake.
        if (!/\bdefault\b/i.test(raw)) required.add(first);
      }
      signatures.set(name.toLowerCase(), { args, required });
    }
  }
  return signatures;
};

const scanned = () => [
  ...callSiteFiles(join(root, 'lib')),
  ...callSiteFiles(join(root, 'app')),
  ...callSiteFiles(join(root, 'components')),
  ...callSiteFiles(join(root, 'src')),
  ...callSiteFiles(join(root, 'supabase', 'functions')),
];

/** Every `supabase.rpc('name', { a: …, b: … })` in the tree, with the keys it passes. */
const callSites = (): { file: string; fn: string; args: string[] }[] => {
  const found: { file: string; fn: string; args: string[] }[] = [];
  for (const file of scanned()) {
    const source = readFileSync(file, 'utf8');
    const pattern = /\.rpc\(\s*'([\w]+)'\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g;
    for (const [, fn, body] of source.matchAll(pattern)) {
      if (fn === undefined) continue;
      const args =
        body === undefined
          ? []
          : // Object keys only. Anchored on a separator so a value's own identifiers
            // cannot be mistaken for keys, and the lookahead accepts BOTH `awards: x`
            // and the ES6 shorthand `awards` — missing the shorthand made
            // `finalize_wrapped({ year_id, awards })` look like it omitted a required
            // argument, which is a false alarm from the guard rather than a bug in the
            // call. A guard that cries wolf gets muted, so it has to read real code.
            [...body.matchAll(/(?:^|[,{])\s*([A-Za-z_]\w*)\s*(?=[:,}]|$)/g)].flatMap((m) =>
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

  /**
   * The assertion that keeps the rest honest.
   *
   * Every check below is over the call sites the regex could READ, so a call it cannot
   * parse is not a failure — it is an absence, and absences pass. Four already hid that
   * way: `lib/queries/invitations.ts` reached its four roster verbs through a
   * `call(fn, arg)` helper, so `approve_member`, `reject_member`, `remove_member` and
   * `revoke_invitation` — the Organizer's whole surface — were never checked by the guard
   * that exists to check them.
   *
   * So the count has to match. A `.rpc(` this file cannot read is now a failure with the
   * line in the message, and the fix is to write the name as a literal.
   */
  it('can read every .rpc( in the tree — an unparsed call is a hole, not a pass', () => {
    const unreadable: string[] = [];
    for (const file of scanned()) {
      const source = readFileSync(file, 'utf8');
      const total = [...source.matchAll(/\.rpc\s*[<(]/g)].length;
      const parsed = sites.filter((s) => s.file === file.slice(root.length + 1)).length;
      if (total !== parsed) {
        unreadable.push(`${file.slice(root.length + 1)}: ${total} .rpc( calls, ${parsed} readable`);
      }
    }
    expect(unreadable).toEqual([]);
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
        if (!declared.args.has(arg)) {
          wrong.push(
            `${site.file}: ${site.fn}({ ${arg}: … }) — accepts ${[...declared.args].join(', ')}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The other direction, and the one a subset check cannot see.
   *
   * A missing argument fails exactly like a misspelled one — PostgREST resolves by the
   * full set of names, so dropping `target:` from a `write_goal` call produces the same
   * "could not find the function" as typing `targett:`. Checking only that every argument
   * passed is accepted leaves that whole half unguarded.
   */
  it('passes every argument that has no DEFAULT', () => {
    const missing: string[] = [];
    for (const site of sites) {
      const declared = signatures.get(site.fn.toLowerCase());
      if (declared === undefined) continue;
      for (const need of declared.required) {
        if (!site.args.includes(need)) {
          missing.push(`${site.file}: ${site.fn}() is missing required ${need}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('knows about the functions this guard was written for', () => {
    // A canary on the parser itself. If a migration is reformatted in a way this regex
    // cannot read, every assertion above passes vacuously — these fail loudly first.
    expect(signatures.get('write_goal')?.args).toContain('unit_canonical');
    // Added by migration 33, which DROPs and recreates rather than replacing — proof the
    // "last declaration wins" walk is picking up the newest signature.
    expect(signatures.get('write_goal')?.args).toContain('sharpened');
    expect(signatures.get('write_goal')?.required).toContain('tile_id');
    expect(signatures.get('write_goal')?.required).not.toContain('unit');
    expect(signatures.get('consume_sharpen')?.args).toContain('target_member_id');
  });
});
