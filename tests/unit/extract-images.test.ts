import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { extractImages } from '../../src/engines/mupdf-images';
import { protect } from '../../src/engines/mupdf-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

/** Decodes a saved picture so tests can check its pixels. */
function decode(bytes: Uint8Array) {
  const image = new mupdf.Image(bytes);
  const pix = image.toPixmap();
  const out = { w: pix.getWidth(), h: pix.getHeight(), n: pix.getNumberOfComponents(), alpha: pix.getAlpha(), px: new Uint8Array(pix.getPixels()) };
  pix.destroy();
  image.destroy();
  return { ...out, at: (x: number, y: number) => [...out.px.subarray((y * out.w + x) * out.n, (y * out.w + x + 1) * out.n)] };
}

describe('extractImages', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;
  const mixed = get('29-images-mixed.pdf');
  const all = { pages: [0, 1, 2], skipTiny: true };

  it('finds every picture once, including one inside a placed page', () => {
    const r = extractImages(mupdf, mixed, all);
    expect(r.images.map((i) => [i.page, i.index, i.ext, i.width, i.height])).toEqual([
      [0, 1, 'jpg', 400, 300],
      [0, 2, 'png', 300, 300],
      [1, 1, 'jpg', 320, 240],
      [2, 1, 'png', 300, 200],
      [2, 2, 'png', 200, 200],
    ]);
    expect(r).toMatchObject({ tiny: 1, repeats: 1, failed: 0, truncated: false });
    expect(r.files).toHaveLength(5);
  });

  it('copies a JPEG photo byte for byte', () => {
    const r = extractImages(mupdf, mixed, all);
    const pdf = mupdf.Document.openDocument(mixed, 'application/pdf').asPDF()!;
    const originals: string[] = [];
    for (let i = 1; i < pdf.countObjects(); i++) {
      const obj = pdf.newIndirect(i);
      if (obj.isStream() && obj.get('Filter').toString() === '/DCTDecode') originals.push(Buffer.from(obj.readRawStream().asUint8Array()).toString('hex'));
    }
    pdf.destroy();
    for (const i of [0, 2]) expect(originals).toContain(Buffer.from(r.files[i]!).toString('hex'));
    expect(decode(r.files[2]!).n).toBe(1); // still grayscale
  });

  it('keeps transparency and the right way up', () => {
    const r = extractImages(mupdf, mixed, all);
    const circle = decode(r.files[1]!);
    expect(circle.alpha).toBe(1);
    expect(circle.at(0, 0)[3]).toBe(0); // corner: see-through
    expect(circle.at(150, 150)).toEqual([220, 60, 60, 255]); // centre: solid red
    // Stripes: the top-left pixel is white and the next one down is still white,
    // which would be blue if the picture were flipped.
    const striped = decode(r.files[4]!);
    expect(striped.at(0, 0)).toEqual([250, 250, 250]);
    expect(striped.at(1, 0)).toEqual([250, 250, 250]);
    expect(striped.at(41, 0)).toEqual([40, 90, 200]);
  });

  it('turns a CMYK picture into normal RGB colours', () => {
    const r = extractImages(mupdf, mixed, all);
    const cmyk = decode(r.files[3]!);
    expect(cmyk.n).toBe(3);
    // Little cyan, some magenta, lots of yellow: an orange-yellow, not black.
    const [red, green, blue] = cmyk.at(0, 100);
    expect(red).toBeGreaterThan(200);
    expect(green).toBeGreaterThan(150);
    expect(blue).toBeLessThan(140);
  });

  it('can include tiny pictures and limit the pages', () => {
    const r = extractImages(mupdf, mixed, { pages: [0], skipTiny: false });
    expect(r.images.map((i) => [i.width, i.height])).toEqual([[400, 300], [300, 300], [16, 16]]);
    expect(r.tiny).toBe(0);
    // The photo is only a repeat when page 1 was searched first.
    expect(extractImages(mupdf, mixed, { pages: [1], skipTiny: true }).images).toHaveLength(2);
  });

  it('reports no pictures in a PDF without any', () => {
    const r = extractImages(mupdf, get('30-no-images.pdf'), { pages: [0, 1], skipTiny: true });
    expect(r).toMatchObject({ images: [], files: [], tiny: 0, repeats: 0, failed: 0 });
    expect(extractImages(mupdf, makePdf(2), { pages: [0, 1], skipTiny: false }).images).toEqual([]);
  });

  it('ignores page numbers outside the PDF', () => {
    expect(extractImages(mupdf, mixed, { pages: [-1, 7], skipTiny: true }).images).toEqual([]);
  });

  it('asks for the password to be removed first', () => {
    const locked = protect(mupdf, mixed, { password: 'x', allowPrint: true, allowCopy: true, allowEdit: true });
    expect(() => extractImages(mupdf, locked, all)).toThrow(/Unlock it first/);
  });

  it('survives a group that contains itself', async () => {
    const { PDFDocument, PDFName, PDFDict, PDFRawStream } = await import('pdf-lib');
    const doc = await PDFDocument.load(mixed);
    // Make the placed page's group list itself among its own resources.
    const page3 = doc.getPage(2).node;
    const xobjects = page3.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    let loops = 0;
    for (const [, ref] of xobjects.entries()) {
      const form = doc.context.lookup(ref);
      if (!(form instanceof PDFRawStream)) continue;
      if (form.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue;
      const res = form.dict.lookup(PDFName.of('Resources'), PDFDict);
      res.lookup(PDFName.of('XObject'), PDFDict).set(PDFName.of('Loop'), ref);
      loops++;
    }
    expect(loops).toBe(1);
    const r = extractImages(mupdf, await doc.save(), { pages: [2], skipTiny: true });
    expect(r.images).toHaveLength(2);
  });
});
