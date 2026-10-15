import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import {
  addPageNumbers,
  addWatermark,
  imagesToPdf,
  merge,
  organize,
  pageCount,
  pick,
  readMetadata,
  stripMetadata,
} from '../../src/engines/pdflib-ops';
import { makePdf, TINY_PNG } from '../fixtures/make-pdf';

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

describe('merge', () => {
  it('joins pages in file order', async () => {
    const out = await merge([makePdf(2), makePdf(3)]);
    expect(await widths(out)).toEqual([200, 201, 200, 201, 202]);
  });
  it('needs two files', async () => {
    await expect(merge([makePdf(1)])).rejects.toThrow(/at least two/);
  });
});

describe('pick (split / extract)', () => {
  it('builds one PDF per group', async () => {
    const outs = await pick(makePdf(5), [[0, 1], [4]]);
    expect(outs).toHaveLength(2);
    expect(await widths(outs[0]!)).toEqual([200, 201]);
    expect(await widths(outs[1]!)).toEqual([204]);
  });
  it('rejects out-of-range pages', async () => {
    await expect(pick(makePdf(2), [[5]])).rejects.toThrow(/out of range/);
  });
});

describe('organize', () => {
  it('reorders, deletes and rotates', async () => {
    const out = await organize(makePdf(4), [
      { index: 3, rotate: 90 },
      { index: 0, rotate: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([203, 200]);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });
  it('refuses an empty result', async () => {
    await expect(organize(makePdf(2), [])).rejects.toThrow(/at least one/);
  });
});

describe('images to PDF', () => {
  it('makes one page per image', async () => {
    const out = await imagesToPdf(
      [
        { bytes: TINY_PNG, kind: 'png' },
        { bytes: TINY_PNG, kind: 'png' },
      ],
      'a4',
    );
    expect(await pageCount(out)).toBe(2);
  });
  it('rejects a broken image', async () => {
    await expect(imagesToPdf([{ bytes: new Uint8Array([1, 2, 3]), kind: 'png' }], 'fit')).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe('stamps', () => {
  it('adds page numbers and watermark without changing page count', async () => {
    const numbered = await addPageNumbers(makePdf(3), {
      position: 'bottom-center',
      startAt: 1,
      fontSize: 12,
      format: 'n-of-total',
    });
    expect(await pageCount(numbered)).toBe(3);
    const marked = await addWatermark(numbered, { text: 'DRAFT', fontSize: 48, opacity: 0.2, diagonal: true });
    expect(await pageCount(marked)).toBe(3);
  });
  it('requires watermark text', async () => {
    await expect(addWatermark(makePdf(1), { text: '  ', fontSize: 40, opacity: 0.3, diagonal: false })).rejects.toThrow(
      /Enter watermark/,
    );
  });
});

describe('metadata', () => {
  it('removes author, title and producer', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle('Secret plan');
    doc.setAuthor('Someone');
    doc.setProducer('Some app');
    const bytes = await doc.save();
    expect(await readMetadata(bytes)).toMatchObject({ Title: 'Secret plan', Author: 'Someone' });
    const cleaned = await stripMetadata(bytes);
    const meta = await readMetadata(cleaned);
    expect(meta.Title).toBeUndefined();
    expect(meta.Author).toBeUndefined();
    expect(meta.Producer).toBeUndefined();
    expect(new TextDecoder('latin1').decode(cleaned)).not.toContain('Secret plan');
  });
});

describe('hostile input', () => {
  it('rejects encrypted PDFs with a clear message', async () => {
    await expect(pageCount(makePdf(1, { encrypted: true }))).rejects.toThrow(/password-protected/);
  });
  it('rejects truncated and garbage files', async () => {
    await expect(pageCount(makePdf(3, { truncate: true }))).rejects.toThrow();
    await expect(pageCount(new TextEncoder().encode('%PDF-1.7 garbage'))).rejects.toThrow(/could not be read/);
  });
  it('rejects documents above the page limit', async () => {
    await expect(pageCount(makePdf(5001))).rejects.toThrow(/more than 5000 pages/);
  });
});

describe('addSignature', async () => {
  const mupdf = await import('mupdf');
  const { addSignature } = await import('../../src/engines/pdflib-ops');

  // A 40x20 test "signature": top half red, bottom half blue, so the test can
  // tell where it landed and that it is the right way up.
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], false);
  const px = pix.getPixels();
  for (let i = 0; i < 40 * 20; i++) px.set(i < 40 * 10 ? [255, 0, 0] : [0, 0, 255], i * 3);
  const sig = { bytes: pix.asPNG(), kind: 'png' as const };

  // Colour at a point given as fractions of the page as shown on screen.
  const colourAt = (bytes: Uint8Array, page: number, fx: number, fy: number) => {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const shot = doc.loadPage(page).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
    const [w, h] = [shot.getWidth(), shot.getHeight()];
    const i = (Math.floor(fy * h) * w + Math.floor(fx * w)) * 3;
    const [r, g, b] = Array.from(shot.getPixels().slice(i, i + 3));
    doc.destroy();
    return r! > 200 && g! < 60 && b! < 60 ? 'red' : b! > 200 && r! < 60 && g! < 60 ? 'blue' : r! > 240 && g! > 240 && b! > 240 ? 'white' : 'other';
  };

  for (const rotation of [0, 90, 180, 270]) {
    it(`lands where it was placed, upright, on a page rotated ${rotation}°`, async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 600]).setRotation(degrees(rotation));
      // Box from 50% to 90% across, its top at 20% down: 0.4 wide, half as tall.
      const out = await addSignature(await doc.save(), sig, [{ page: 0, x: 0.5, y: 0.2, width: 0.4 }]);
      const shownW = rotation % 180 ? 600 : 400;
      const shownH = rotation % 180 ? 400 : 600;
      const boxH = (0.4 * shownW) / 2 / shownH; // box height as a fraction of the shown page
      expect(colourAt(out, 0, 0.7, 0.2 + boxH * 0.25)).toBe('red');
      expect(colourAt(out, 0, 0.7, 0.2 + boxH * 0.75)).toBe('blue');
      expect(colourAt(out, 0, 0.3, 0.2 + boxH * 0.5)).toBe('white');
    });
  }

  it('can sign several pages and refuses pages that do not exist', async () => {
    const out = await addSignature(makePdf(3), sig, [0, 2].map((page) => ({ page, x: 0.1, y: 0.1, width: 0.3 })));
    expect(colourAt(out, 0, 0.2, 0.11)).toBe('red');
    expect(colourAt(out, 1, 0.2, 0.11)).toBe('white');
    expect(colourAt(out, 2, 0.2, 0.11)).toBe('red');
    await expect(addSignature(makePdf(1), sig, [{ page: 5, x: 0, y: 0, width: 0.3 }])).rejects.toThrow('no page 6');
    await expect(addSignature(makePdf(1), { bytes: new Uint8Array([1, 2, 3]), kind: 'png' }, [{ page: 0, x: 0, y: 0, width: 0.3 }])).rejects.toThrow('could not be read');
  });
});
