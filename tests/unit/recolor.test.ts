import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { recolorOverlay } from '../../src/engines/recolor';
import { recolorRaster } from '../../src/engines/mupdf-recolor';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

type Shown = { w: number; h: number; pixels: Uint8ClampedArray; text: string; annots: number; widgets: number; bounds: number[] };

/** Each page as shown (crop and rotation applied), drawn in RGB with comments and fields, plus its text. */
function render(bytes: Uint8Array): Shown[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const out: Shown[] = [];
  try {
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i) as mupdf.PDFPage;
      const pix = page.toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceRGB, false, true);
      out.push({
        w: pix.getWidth(),
        h: pix.getHeight(),
        pixels: new Uint8ClampedArray(pix.getPixels()),
        text: page.toStructuredText('').asText(),
        annots: page.getAnnotations().length,
        widgets: page.getWidgets().length,
        bounds: page.getBounds(),
      });
      pix.destroy();
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
  return out;
}

/** The biggest difference between the red, green and blue of any one pixel (0 = all grey). */
function maxColourfulness(p: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < p.length; i += 3) {
    max = Math.max(max, Math.abs(p[i]! - p[i + 1]!), Math.abs(p[i + 1]! - p[i + 2]!), Math.abs(p[i]! - p[i + 2]!));
  }
  return max;
}

/** Average distance between `after` and the exact opposite of `before` (0 = perfectly inverted). */
function inversionError(before: Uint8ClampedArray, after: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < before.length; i++) sum += Math.abs(255 - before[i]! - after[i]!);
  return sum / before.length;
}

describe('recolor, keep-text mode', () => {
  it('turns every page fully grey, including the turned and cropped ones, and keeps the text', async () => {
    const source = await get('40-colourful-mixed.pdf');
    const before = render(source);
    expect(maxColourfulness(before[0]!.pixels)).toBeGreaterThan(100);
    const after = render(await recolorOverlay(source, { effect: 'greyscale', pages: [] }));
    expect(after).toHaveLength(3);
    after.forEach((page, i) => {
      expect(maxColourfulness(page.pixels), `page ${i + 1}`).toBeLessThanOrEqual(2);
      expect([page.w, page.h]).toEqual([before[i]!.w, before[i]!.h]);
      expect(page.text).toContain('Red text you can select');
    });
  });

  it('inverts every pixel of the chosen pages only', async () => {
    const source = await get('40-colourful-mixed.pdf');
    const before = render(source);
    const after = render(await recolorOverlay(source, { effect: 'invert', pages: [1, 2] }));
    expect(inversionError(before[1]!.pixels, after[1]!.pixels)).toBeLessThan(2);
    expect(inversionError(before[2]!.pixels, after[2]!.pixels)).toBeLessThan(2);
    // Page 1 was not chosen, so it is unchanged.
    expect(after[0]!.pixels).toEqual(before[0]!.pixels);
    expect(after[1]!.text).toContain('Green text you can select');
  });

  it('works on pages without any content yet', async () => {
    const after = render(await recolorOverlay(makePdf(2), { effect: 'invert', pages: [] }));
    expect(after[0]!.pixels.every((v) => v === 0)).toBe(true);
  });

  it('leaves comments and form fields as they are', async () => {
    const source = await get('41-colour-with-comments.pdf');
    const after = render(await recolorOverlay(source, { effect: 'greyscale', pages: [] }));
    expect(after[0]).toMatchObject({ annots: 2, widgets: 1 });
    // The yellow highlight is drawn above the filter, so colour remains.
    expect(maxColourfulness(after[0]!.pixels)).toBeGreaterThan(100);
  });

  it('refuses pages that are not in the file', async () => {
    await expect(recolorOverlay(makePdf(2), { effect: 'invert', pages: [2] })).rejects.toThrow('not in this PDF');
  });
});

describe('recolor, image-based mode', () => {
  it('makes grey pictures of the pages, comments and fields included', async () => {
    const source = await get('41-colour-with-comments.pdf');
    const before = render(source);
    const out = recolorRaster(mupdf, source, { effect: 'greyscale', dpi: 150, pages: [] });
    const after = render(out);
    expect(after[0]).toMatchObject({ annots: 0, widgets: 0, text: '' });
    expect(after[0]!.bounds).toEqual(before[0]!.bounds);
    expect(maxColourfulness(after[0]!.pixels)).toBeLessThanOrEqual(2);

    // The picture itself is stored with one grey channel, so no colour is left in the file.
    const doc = mupdf.Document.openDocument(out, 'application/pdf').asPDF()!;
    const image = (doc.loadPage(0) as mupdf.PDFPage).getObject().get('Resources').get('XObject').get('Im0').resolve();
    // MuPDF writes the grey colour space as a one-channel ICC profile.
    const space = image.get('ColorSpace').resolve();
    expect(space.get(0).asName()).toBe('ICCBased');
    expect(space.get(1).get('N').asNumber()).toBe(1);
    expect(image.get('Width').asNumber()).toBe(Math.ceil((before[0]!.bounds[2]! * 150) / 72));
    doc.destroy();
  });

  it('inverts the turned and cropped pages as shown, and copies other pages unchanged', async () => {
    const source = await get('40-colourful-mixed.pdf');
    const before = render(source);
    const after = render(recolorRaster(mupdf, source, { effect: 'invert', dpi: 150, pages: [1, 2] }));
    expect(after).toHaveLength(3);
    expect(after[0]!.text).toContain('Red text you can select');
    for (const i of [1, 2]) {
      expect([after[i]!.w, after[i]!.h]).toEqual([before[i]!.w, before[i]!.h]);
      expect(after[i]!.text).toBe('');
      // Resampling softens edges a little, so allow a small average error.
      expect(inversionError(before[i]!.pixels, after[i]!.pixels), `page ${i + 1}`).toBeLessThan(6);
    }
  });

  it('refuses an unknown resolution and pages that are not in the file', () => {
    expect(() => recolorRaster(mupdf, makePdf(1), { effect: 'greyscale', dpi: 600 as 300, pages: [] })).toThrow('150 or 300');
    expect(() => recolorRaster(mupdf, makePdf(1), { effect: 'greyscale', dpi: 150, pages: [3] })).toThrow('not in this PDF');
  });
});
