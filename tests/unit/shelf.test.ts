import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPdfResult, latestPdfFrom, sameBytes, timeAgo, trimNewestFirst } from '../../src/core/shelf-rules';
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

const pdfBlob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
const zipBlob = new Blob(['PK'], { type: 'application/zip' });
const saved = (id: number, name: string, blob: Blob, tool: string | null, at: number) => ({ id, name, blob, tool, at });

describe('isPdfResult', () => {
  it('accepts PDF results only', () => {
    expect(isPdfResult({ name: 'a-watermarked.pdf', blob: pdfBlob })).toBe(true);
    expect(isPdfResult({ name: 'A.PDF', blob: pdfBlob })).toBe(true);
    expect(isPdfResult({ name: 'a-parts.zip', blob: zipBlob })).toBe(false);
    expect(isPdfResult({ name: 'a.txt', blob: new Blob(['x'], { type: 'text/plain' }) })).toBe(false);
    // A PDF name on something that is not a PDF, or the other way round, is refused.
    expect(isPdfResult({ name: 'a.pdf', blob: zipBlob })).toBe(false);
    expect(isPdfResult({ name: 'a.zip', blob: pdfBlob })).toBe(false);
  });
});

describe('latestPdfFrom', () => {
  const list = [
    saved(5, 'b-parts.zip', zipBlob, 'split', 50),
    saved(4, 'b-numbered.pdf', pdfBlob, 'page-numbers', 40),
    saved(3, 'a-watermarked.pdf', pdfBlob, 'watermark', 30),
    saved(2, 'old-watermarked.pdf', pdfBlob, 'watermark', 10),
  ];
  it('picks the newest PDF the tool saved since it opened', () => {
    expect(latestPdfFrom(list, 'watermark', 20)?.id).toBe(3);
    expect(latestPdfFrom(list, 'watermark', 30)?.id).toBe(3);
  });
  it('ignores results from before the tool opened', () => {
    expect(latestPdfFrom(list, 'watermark', 31)).toBeUndefined();
  });
  it('ignores other tools and results that are not PDFs', () => {
    expect(latestPdfFrom(list, 'split', 0)).toBeUndefined();
    expect(latestPdfFrom(list, 'compress', 0)).toBeUndefined();
  });
});
