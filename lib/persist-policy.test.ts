import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSISTED_PREFIXES, shouldPersistKey } from './persist-policy';

describe('§17.5 — the Board and the Feed open to content', () => {
  it.each([
    ['the Board', ['board', 'board-1', 'account-1']],
    ["the Board's header", ['board-head', 'board-1', 'account-1']],
    ['the list of Boards in a Year', ['boards', 'year-1', 'account-1']],
    ['the counts the growth ladder is derived from', ['tile-counts', 'a,b,c', 'account-1']],
    ['the Milestones completion is gated on', ['milestones', 'board', 'm1', 'y1', 'a1']],
    ["the sheet's Recent list", ['increments', 'tile-1', 'account-1']],
    ['the Feed', ['feed', 'family-1', 'year-1', 'account-1']],
    ['the roster the Feed names people from', ['roster', 'family-1']],
    ['the Family name in the header', ['families', 'account-1']],
    ['the Year in the header', ['years', 'family-1']],
  ])('persists %s', (_what, key) => {
    expect(shouldPersistKey(key)).toBe(true);
  });
});

describe('§7.6 — a signed URL is never written to a disk', () => {
  it('refuses the photo URL cache', () => {
    // The single most important line in this file. A signed URL is a stateless HMAC that
    // nothing revokes (§16.2); persisted, it is a long-lived URL to a photograph of a
    // child, readable long after the app was closed.
    expect(shouldPersistKey(['photo-urls', 'account-1', 'family/increment.jpg'])).toBe(false);
  });

  it('refuses it however the key is spelled', () => {
    expect(shouldPersistKey(['photo-urls'])).toBe(false);
    expect(shouldPersistKey(['photo-urls', 'anything', 'at', 'all'])).toBe(false);
  });
});

describe('the allowlist denies by default', () => {
  it.each([
    ['a live vote, which is online-only and misleading when stale', ['centre', 'year-1', 'a1', 'f1']],
    ['pending memberships', ['pending', 'account-1']],
    ['a query nobody has thought about yet', ['some-future-query', 'x']],
  ])('refuses %s', (_what, key) => {
    expect(shouldPersistKey(key)).toBe(false);
  });

  it('refuses anything that is not a key at all', () => {
    expect(shouldPersistKey(undefined)).toBe(false);
    expect(shouldPersistKey(null)).toBe(false);
    expect(shouldPersistKey('board')).toBe(false);
    expect(shouldPersistKey([])).toBe(false);
    expect(shouldPersistKey([{ scope: 'board' }])).toBe(false);
    expect(shouldPersistKey([12])).toBe(false);
  });

  it('matches on the first segment only, so a nested word cannot smuggle a key in', () => {
    expect(shouldPersistKey(['photo-urls', 'board'])).toBe(false);
    expect(shouldPersistKey(['x', 'feed'])).toBe(false);
  });
});

/**
 * The allowlist is only true if it names keys that exist. A prefix renamed in
 * `lib/queries/` and not renamed here fails open — the query stops being persisted and
 * §17.5 quietly stops holding, with nothing on screen to show it.
 */
describe('every persisted prefix is a prefix some query actually uses', () => {
  const sources = readdirSync('lib/queries')
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join('lib/queries', name), 'utf8'))
    .join('\n');

  it.each(PERSISTED_PREFIXES)('%s is named in lib/queries', (prefix) => {
    expect(sources).toContain(`['${prefix}'`);
  });

  it("and the one prefix that must never be persisted is one of ours, so it can't be a typo", () => {
    expect(sources).toContain("['photo-urls'");
  });
});
