import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loaded, styles } from './fonts';
import { type } from './tokens';

describe('resolved styles (§1)', () => {
  it('names a face the renderer has actually loaded, for every token', () => {
    const faces = new Set<string>(Object.values(loaded));
    for (const [name, style] of Object.entries(styles)) {
      expect(faces, `${name} resolves to a loaded face`).toContain(style.fontFamily);
    }
  });

  it('covers every token in the type scale', () => {
    expect(Object.keys(styles).sort()).toEqual(Object.keys(type).sort());
  });

  it('drops fontWeight, so neither platform synthesises a second bold', () => {
    for (const style of Object.values(styles)) {
      expect(style).not.toHaveProperty('fontWeight');
    }
  });

  it('keeps Shippori for the three display tokens and nothing else', () => {
    // §1.1: never below 19pt, never on a control.
    expect(styles.display.fontFamily).toBe(loaded.display);
    expect(styles.title.fontFamily).toBe(loaded.display);
    expect(styles.cardHead.fontFamily).toBe(loaded.display);
    for (const key of ['heading', 'body', 'label', 'meta'] as const) {
      expect(styles[key].fontFamily).not.toBe(loaded.display);
    }
  });
});

describe('no component spreads a raw type token', () => {
  // The bug this guards against is silent: a raw token names the design system's family,
  // which the renderer has never heard of, so the text falls back to the system font and
  // nothing warns. It shipped that way in the first button written against these tokens.
  const sources = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? sources(join(dir, e.name))
          : e.name.endsWith('.tsx')
            ? [join(dir, e.name)]
            : [],
      );
    } catch {
      return [];
    }
  };

  it('uses theme/fonts styles rather than theme/tokens type', () => {
    const offenders = [...sources('app'), ...sources('components')].filter((file) =>
      /\.\.\.type\.\w+/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
