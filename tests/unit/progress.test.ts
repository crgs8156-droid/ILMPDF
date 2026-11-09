// Engine progress reports ("page 3 of 20"): the throttle, the words the
// tools show, and that each long MuPDF job reports every step it goes through.
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { progressLabel, throttled, type ProgressStep } from '../../src/engines/progress';
import { compress } from '../../src/engines/mupdf-ops';
import { recolorRaster } from '../../src/engines/mupdf-recolor';
import { extractImages } from '../../src/engines/mupdf-images';
import { flatten } from '../../src/engines/mupdf-flatten';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

type Report = [number, number, ProgressStep];
const recorder = () => {
  const seen: Report[] = [];
  return { seen, report: (done: number, total: number, step: ProgressStep) => void seen.push([done, total, step]) };
};

describe('throttled', () => {
  it('passes one report per interval, but always the last one and every new step', () => {
    let t = 0;
    const { seen, report } = recorder();
    const p = throttled(report, 100, () => t);
    p(0, 10, 'page'); // first: through
    t = 50;
    p(1, 10, 'page'); // too soon: dropped
    t = 120;
    p(2, 10, 'page'); // through
    t = 130;
    p(10, 10, 'page'); // finished: through
    p(0, 1, 'save'); // new step: through
    expect(seen).toEqual([
      [0, 10, 'page'],
      [2, 10, 'page'],
      [10, 10, 'page'],
      [0, 1, 'save'],
    ]);
  });
});

describe('progressLabel', () => {
  it('counts from 1 for people', () => {
    expect(progressLabel(0, 20, 'page')).toBe('Working on page 1 of 20…');
    expect(progressLabel(4, 9, 'image')).toBe('Working on image 5 of 9…');
    expect(progressLabel(9, 9, 'image')).toBe('All 9 images done, finishing…');
    expect(progressLabel(0, 1, 'save')).toBe('Saving the new file…');
  });
});

describe('engines report progress', () => {
  it('Greyscale (image-based) reports each chosen page, then saving', () => {
    const { seen, report } = recorder();
    recolorRaster(mupdf, makePdf(4), { effect: 'greyscale', dpi: 150, pages: [1, 3] }, report);
    expect(seen).toEqual([
      [0, 2, 'page'],
      [1, 2, 'page'],
      [0, 1, 'save'],
    ]);
  });

  it('Extract images reports each page it reads', () => {
    const { seen, report } = recorder();
    extractImages(mupdf, makePdf(3), { pages: [0, 1, 2], skipTiny: true }, report);
    expect(seen).toEqual([
      [0, 3, 'page'],
      [1, 3, 'page'],
      [2, 3, 'page'],
    ]);
  });

  it('Compress reports each image, then saving, and still shrinks the file', async () => {
    const scanned = await get('17-scanned-heavy.pdf');
    const { seen, report } = recorder();
    const out = compress(mupdf, scanned, 'strong', report);
    const images = seen.filter(([, , s]) => s === 'image');
    expect(images.length).toBeGreaterThan(0);
    expect(images.map(([d]) => d)).toEqual(images.map((_, i) => i));
    expect(seen.at(-1)).toEqual([0, 1, 'save']);
    expect(out.after).toBeLessThan(out.before);
  });

  it('Light compress has no images to go through, only saving', () => {
    const { seen, report } = recorder();
    compress(mupdf, makePdf(2), 'light', report);
    expect(seen).toEqual([[0, 1, 'save']]);
  });

  it('Flatten reports each page it checks, then saving', async () => {
    const form = await get('15-form.pdf');
    const pages = mupdf.Document.openDocument(form, 'application/pdf').countPages();
    const { seen, report } = recorder();
    flatten(mupdf, form, { fields: true, annotations: true }, report);
    expect(seen).toEqual([...Array.from({ length: pages }, (_, i): Report => [i, pages, 'page']), [0, 1, 'save']]);
  });
});
