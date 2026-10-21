// Checks the blank-page rules against test file 35. The app draws pages with
// PDF.js in the browser; here MuPDF draws them at the same small size, which
// is close enough to check that each sensitivity finds the expected pages.
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { inkFraction, SENSITIVITY, type Sensitivity } from '../../src/engines/blank-pages';
// @ts-expect-error: plain JavaScript script without type declarations
import { pageToolsTestFiles } from '../../scripts/page-tools-test-pdfs.mjs';

type TestFile = { name: string; bytes: Uint8Array };

async function inkPerPage(bytes: Uint8Array): Promise<{ ink: (edge: number) => number }[]> {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const scale = 240 / Math.max(x1 - x0, y1 - y0);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const w = pix.getWidth();
    const h = pix.getHeight();
    const rgb = pix.getPixels();
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) rgba.set([rgb[p * 3]!, rgb[p * 3 + 1]!, rgb[p * 3 + 2]!, 255], p * 4);
    pages.push({ ink: (edge: number) => inkFraction(rgba, w, h, edge) });
  }
  return pages;
}

describe('blank-page sensitivity on test file 35', async () => {
  const files: TestFile[] = await pageToolsTestFiles();
  const pages = await inkPerPage(files.find((f) => f.name === '35-blank-pages.pdf')!.bytes);
  const blankAt = (s: Sensitivity) =>
    pages.flatMap((p, i) => (p.ink(SENSITIVITY[s].edge) <= SENSITIVITY[s].maxInk ? [i + 1] : []));

  it('"only completely empty" finds the two empty pages', () => {
    expect(blankAt('strict')).toEqual([2, 7]);
  });
  it('"a few stray marks" also finds the page with one dot', () => {
    expect(blankAt('normal')).toEqual([2, 4, 7]);
  });
  it('"near-blank scans" also finds the scanned blank page', () => {
    expect(blankAt('scans')).toEqual([2, 4, 5, 7]);
  });
});
