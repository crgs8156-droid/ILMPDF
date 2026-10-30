import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sameBytes, timeAgo, trimNewestFirst } from '../../src/core/shelf-rules';
import { ONE_PDF_TOOLS } from '../../src/tools/one-pdf-tools';

const item = (id: number, size: number) => ({ id, size });

describe('trimNewestFirst', () => {
  it('keeps the newest entries within the count', () => {
    expect(trimNewestFirst([item(3, 1), item(2, 1), item(1, 1)], 2, 100).map((i) => i.id)).toEqual([3, 2]);
  });
  it('keeps the newest entries within the byte budget', () => {
    expect(trimNewestFirst([item(3, 60), item(2, 50), item(1, 40)], 10, 100).map((i) => i.id)).toEqual([3, 1]);
  });
  it('drops one entry that is too big on its own, but keeps the rest', () => {
    expect(trimNewestFirst([item(2, 500), item(1, 10)], 10, 100).map((i) => i.id)).toEqual([1]);
  });
});

describe('timeAgo', () => {
  it('reads like a person would say it', () => {
    expect(timeAgo(0, 10_000)).toBe('just now');
    expect(timeAgo(0, 5 * 60_000)).toBe('5 min ago');
    expect(timeAgo(0, 2 * 3_600_000)).toBe('2 h ago');
    expect(timeAgo(10_000, 0)).toBe('just now');
  });
});

describe('sameBytes', () => {
  it('compares contents, not identity', () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('ONE_PDF_TOOLS', () => {
  it('lists exactly the tools built on SinglePdf', () => {
    const registry = readFileSync(new URL('../../src/tools/registry.ts', import.meta.url), 'utf8');
    const files = Object.fromEntries([...registry.matchAll(/import (\w+) from '\.\/(\w+)\.svelte';/g)].map((m) => [m[1], m[2]]));
    const uses = [...registry.matchAll(/id: '([a-z-]+)'.*?component: (\w+)/g)]
      .filter((m) => readFileSync(new URL(`../../src/tools/${files[m[2]!]}.svelte`, import.meta.url), 'utf8').includes('SinglePdf'))
      .map((m) => m[1]!);
    expect([...ONE_PDF_TOOLS].sort()).toEqual(uses.sort());
  });
});

describe('the shelf stays in memory', () => {
  it('never touches browser storage', () => {
    for (const f of ['src/core/shelf.svelte.ts', 'src/core/shelf-rules.ts']) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie/);
    }
  });
});
