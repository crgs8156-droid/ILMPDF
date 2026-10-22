import { describe, expect, it } from 'vitest';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, rgb } from 'pdf-lib';
import { insertPages, PAPER, resizePages } from '../../src/engines/pagetools-ops';
import { inkFraction } from '../../src/engines/blank-pages';
import { makePdf } from '../fixtures/make-pdf';

const [A4W, A4H] = PAPER.a4;
const all = { orientation: 'auto' as const, margin: 0, pages: [] as number[] };

async function sizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
}

/** A page with drawn content, a link annotation and optional rotation or crop. */
async function contentPdf(opts: { rotate?: number; crop?: [number, number, number, number] } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(1, 0, 0) });
  if (opts.rotate) page.setRotation(degrees(opts.rotate));
  if (opts.crop) page.setCropBox(...opts.crop);
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [100, 100, 200, 150], QuadPoints: [100, 150, 200, 150, 100, 100, 200, 100] });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
  return doc.save();
}

function numbers(dict: PDFDict, key: string): number[] {
  const arr = dict.lookup(PDFName.of(key), PDFArray);
  return arr.asArray().map((n) => +(n as PDFNumber).asNumber().toFixed(2));
}

async function firstAnnot(bytes: Uint8Array): Promise<PDFDict> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
}

describe('resizePages', () => {
  it('sets every page to the paper size, keeping portrait pages portrait', async () => {
    const out = await resizePages(makePdf(3), { ...all, width: A4W, height: A4H });
    expect(await sizes(out)).toEqual([[595, 842], [595, 842], [595, 842]]);
  });

  it('turns the paper for landscape pages when orientation is "auto"', async () => {
    const out = await resizePages(await contentPdf(), { ...all, width: A4W, height: A4H });
    expect(await sizes(out)).toEqual([[842, 595]]);
  });

  it('forces an orientation when asked', async () => {
    const out = await resizePages(await contentPdf(), { ...all, orientation: 'portrait', width: A4W, height: A4H });
    expect(await sizes(out)).toEqual([[595, 842]]);
  });

  it('only resizes the chosen pages', async () => {
    const out = await resizePages(makePdf(3), { ...all, pages: [1], width: 612, height: 792 });
    expect(await sizes(out)).toEqual([[200, 300], [612, 792], [202, 300]]);
  });

  it('scales the content and moves links to match, centred', async () => {
    // 400 x 300 onto landscape A4 (841.89 x 595.28): limited by height, scale 595.28 / 300.
    const out = await resizePages(await contentPdf(), { ...all, width: A4W, height: A4H });
    const s = A4W / 300;
    const dx = (A4H - 400 * s) / 2;
    const r = numbers(await firstAnnot(out), 'Rect');
    expect(r[0]).toBeCloseTo(100 * s + dx, 1);
    expect(r[1]).toBeCloseTo(100 * s, 1);
    expect(r[2]).toBeCloseTo(200 * s + dx, 1);
    expect(r[3]).toBeCloseTo(150 * s, 1);
    expect(numbers(await firstAnnot(out), 'QuadPoints')[0]).toBeCloseTo(100 * s + dx, 1);
    // The old content is wrapped, not redrawn: a scale instruction comes first.
    const doc = await PDFDocument.load(out);
    const contents = doc.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray);
    expect(contents.size()).toBe(3);
  });

  it('keeps a rotated page rotated and sizes it as it is shown', async () => {
    // Shown as 300 x 400 (portrait) because of the 90° turn.
    const out = await resizePages(await contentPdf({ rotate: 90 }), { ...all, width: A4W, height: A4H });
    const page = (await PDFDocument.load(out)).getPage(0);
    expect(page.getRotation().angle).toBe(90);
    // Unrotated box is landscape, so the page shows as portrait A4.
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([842, 595]);
  });

  it('fits the cropped area, not the whole old page, and drops the old crop', async () => {
    const out = await resizePages(await contentPdf({ crop: [100, 100, 100, 50] }), { ...all, width: A4W, height: A4H });
    const page = (await PDFDocument.load(out)).getPage(0);
    expect(page.getCropBox()).toEqual(page.getMediaBox());
    // The link exactly covered the crop area, so now it fills the page width.
    const r = numbers(await firstAnnot(out), 'Rect');
    expect(r[0]).toBeCloseTo(0, 1);
    expect(r[2]).toBeCloseTo(A4H, 1);
  });

  it('keeps the margin empty', async () => {
    const out = await resizePages(await contentPdf({ crop: [100, 100, 100, 50] }), { ...all, margin: 36, width: A4W, height: A4H });
    const r = numbers(await firstAnnot(out), 'Rect');
    expect(r[0]).toBeCloseTo(36, 1);
    expect(r[2]).toBeCloseTo(A4H - 36, 1);
  });

  it('rejects a page that does not exist', async () => {
    await expect(resizePages(makePdf(2), { ...all, pages: [5], width: A4W, height: A4H })).rejects.toThrow(/no page 6/);
  });
});

describe('insertPages', () => {
  it('adds blank pages the size of the page before them', async () => {
    const out = await insertPages(makePdf(3), { at: 2, blankCount: 2 });
    expect((await sizes(out)).map(([w]) => w)).toEqual([200, 201, 201, 201, 202]);
  });

  it('adds blank pages at the start using page 1 as the model', async () => {
    const out = await insertPages(makePdf(2), { at: 0, blankCount: 1 });
    expect((await sizes(out)).map(([w]) => w)).toEqual([200, 200, 201]);
  });

  it('copies the rotation of the neighbouring page', async () => {
    const out = await insertPages(await contentPdf({ rotate: 90 }), { at: 1, blankCount: 1 });
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  it('inserts every page of another PDF', async () => {
    const other = await PDFDocument.create();
    other.addPage([500, 500]);
    other.addPage([510, 500]);
    const out = await insertPages(makePdf(2), { at: 1, blankCount: 1 }, await other.save());
    expect((await sizes(out)).map(([w]) => w)).toEqual([200, 500, 510, 201]);
  });

  it('rejects a place outside the document', async () => {
    await expect(insertPages(makePdf(2), { at: 3, blankCount: 1 })).rejects.toThrow(/where to insert/);
  });
});

describe('inkFraction', () => {
  const white = (w: number, h: number) => new Uint8ClampedArray(w * h * 4).fill(255);
  it('is 0 for a white page', () => {
    expect(inkFraction(white(10, 10), 10, 10)).toBe(0);
  });
  it('counts dark pixels and ignores very light ones', () => {
    const px = white(10, 10);
    px.set([0, 0, 0], 0); // black
    px.set([240, 240, 240], 4); // paper tint: not ink
    px.set([200, 0, 0], 8); // dark red: ink
    expect(inkFraction(px, 10, 10)).toBeCloseTo(0.02);
  });
  it('can ignore the edges', () => {
    const px = white(10, 10);
    px.set([0, 0, 0], 0);
    expect(inkFraction(px, 10, 10, 0.1)).toBe(0);
  });
});
