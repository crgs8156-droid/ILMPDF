import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { extractText, findText, redact, type RedactBox } from '../../src/engines/mupdf-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const ACCOUNT = '0000 1111 2222 3333';

/** Every byte of the file as text, with streams decompressed, so hidden copies show up. */
function rawText(bytes: Uint8Array): string {
  const pdf = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const clean = pdf.saveToBuffer({ decompress: 'yes' }).asUint8Array();
  pdf.destroy();
  return new TextDecoder('latin1').decode(clean);
}

/** Whether the raw file still holds `text`, written plainly or as hex (pdf-lib writes page text as hex). */
function holds(bytes: Uint8Array, text: string): boolean {
  const raw = rawText(bytes);
  const hex = Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return raw.includes(text) || raw.toLowerCase().includes(hex);
}

/** A 400 x 300 page with a secret line at the top, a public line at the bottom,
 * a red square top right and a grey image bottom right. */
async function samplePdf(rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('SECRET-WORD', { x: 40, y: 250, size: 20, font });
  page.drawText('public line', { x: 40, y: 40, size: 20, font });
  page.drawRectangle({ x: 300, y: 220, width: 60, height: 60, color: rgb(1, 0, 0) });
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  page.drawImage(await doc.embedPng(png), { x: 300, y: 20, width: 60, height: 60 });
  if (rotation) page.setRotation(degrees(rotation));
  return doc.save();
}

describe('findText', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const sample = files.find((f) => f.name === '19-redaction-sample.pdf')!.bytes;

  it('finds a phrase on every page, rotated ones included, ignoring case', () => {
    const boxes = findText(mupdf, sample, ACCOUNT);
    expect(boxes.map((b) => b.page)).toEqual([0, 1]);
    expect(findText(mupdf, sample, 'jane EXAMPLE')).toHaveLength(1);
    for (const b of boxes) {
      for (const n of [b.x, b.y, b.width, b.height]) expect(n).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1);
      expect(b.y + b.height).toBeLessThanOrEqual(1);
    }
  });

  it('gives fractions of the page as shown', async () => {
    // SECRET-WORD sits 40 pt from the left and near the top of a 400 x 300 page.
    const [box] = findText(mupdf, await samplePdf(), 'secret-word');
    expect(box!.x).toBeCloseTo(40 / 400 - 1 / 400, 2);
    expect(box!.y).toBeLessThan(0.2);
    // Turned a quarter, the same words run down the right-hand side.
    const [turned] = findText(mupdf, await samplePdf(90), 'secret-word');
    expect(turned!.x).toBeGreaterThan(0.8);
    expect(turned!.height).toBeGreaterThan(turned!.width);
  });

  it('finds nothing for text that is not there, and refuses an empty search', () => {
    expect(findText(mupdf, sample, 'not in this file')).toEqual([]);
    expect(() => findText(mupdf, sample, '   ')).toThrow('Type the text');
    expect(() => findText(mupdf, sample, 'x'.repeat(201))).toThrow('at most 200');
  });
});

describe('redact', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;
  const sample = get('19-redaction-sample.pdf');

  it('removes found text from the file itself, on every page, and keeps the rest', () => {
    const boxes = findText(mupdf, sample, ACCOUNT);
    const { file, boxes: count, pages } = redact(mupdf, sample, boxes, false);
    expect([count, pages]).toEqual([2, 2]);
    const text = extractText(mupdf, file).pages.join('\n');
    expect(text).not.toContain(ACCOUNT);
    expect(text).toContain('Account number:');
    expect(text).toContain('Jane Example');
    expect(text).toContain('Public text on page two.');
  });

  it('leaves no copy of the text anywhere in the file bytes', async () => {
    const doc = await samplePdf();
    expect(holds(doc, 'SECRET-WORD')).toBe(true);
    const { file } = redact(mupdf, doc, findText(mupdf, doc, 'SECRET-WORD'), false);
    expect(holds(file, 'SECRET-WORD')).toBe(false);
    expect(holds(file, 'public line')).toBe(true);
  });

  it('works on rotated pages, using on-screen fractions', async () => {
    for (const turn of [90, 180, 270]) {
      const doc = await samplePdf(turn);
      const { file } = redact(mupdf, doc, findText(mupdf, doc, 'SECRET-WORD'), false);
      const text = extractText(mupdf, file).pages[0]!;
      expect(text, `${turn}°`).not.toContain('SECRET');
      expect(text, `${turn}°`).toContain('public line');
    }
  });

  it('removes a drawn shape that a box covers', async () => {
    const doc = await samplePdf();
    const before = rawText(doc);
    expect(before).toMatch(/1 0 0 rg/); // the red fill
    // The red square: 300-360 across, 20-80 down (of 400 x 300), with a margin.
    const { file } = redact(mupdf, doc, [{ page: 0, x: 290 / 400, y: 10 / 300, width: 80 / 400, height: 80 / 300 }], false);
    expect(rawText(file)).not.toMatch(/1 0 0 rg/);
  });

  it('blanks the pixels of an image under a box', async () => {
    const doc = await samplePdf();
    // The image: 300-360 across, 220-280 down.
    const { file } = redact(mupdf, doc, [{ page: 0, x: 290 / 400, y: 210 / 300, width: 80 / 400, height: 80 / 300 }], false);
    const pdf = mupdf.Document.openDocument(file, 'application/pdf');
    const pixmap = pdf.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
    const at = (x: number, y: number) => {
      const i = (y * pixmap.getWidth() + x) * 3;
      return [...pixmap.getPixels().slice(i, i + 3)];
    };
    expect(at(330, 250)).toEqual([0, 0, 0]); // now the black box, not red
    pdf.destroy();
  });

  it('removes links and form fields under a box, values included', () => {
    const fieldBox: RedactBox = { page: 0, x: 50 / 595.28, y: (841.89 - 425) / 841.89, width: 320 / 595.28, height: 40 / 841.89 };
    const phone = findText(mupdf, sample, '555-0100');
    const { file } = redact(mupdf, sample, [fieldBox, ...phone], false);
    for (const gone of ['Account 0000', 'example.invalid', '555-0100']) {
      expect(holds(sample, gone), gone).toBe(true);
      expect(holds(file, gone), gone).toBe(false);
    }
    expect(holds(file, 'Jane Example')).toBe(true);
    const widgets = (bytes: Uint8Array) => (mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!.loadPage(0) as mupdf.PDFPage).getWidgets().length;
    expect([widgets(sample), widgets(file)]).toEqual([1, 0]);
  });

  it('can remove metadata too', async () => {
    const withMeta = get('08-with-metadata.pdf');
    const box: RedactBox = { page: 0, x: 0, y: 0.9, width: 0.2, height: 0.1 };
    const author = (bytes: Uint8Array) => mupdf.Document.openDocument(bytes, 'application/pdf').getMetaData('info:Author');
    expect(author(redact(mupdf, withMeta, [box], false).file)).toBe('Jane Example');
    expect(author(redact(mupdf, withMeta, [box], true).file)).toBeUndefined();
  });

  it('clips boxes to the page and ignores ones off any page', async () => {
    const doc = await samplePdf();
    const { boxes } = redact(mupdf, doc, [
      { page: 0, x: -1, y: -1, width: 1.2, height: 1.2 },
      { page: 5, x: 0, y: 0, width: 1, height: 1 },
      { page: 0.5, x: 0, y: 0, width: 1, height: 1 },
    ], false);
    expect(boxes).toBe(1);
  });

  it('refuses no boxes, too many boxes and locked files', () => {
    expect(() => redact(mupdf, makePdf(1), [], false)).toThrow('Mark at least one area');
    expect(() => redact(mupdf, makePdf(1), [{ page: 3, x: 0, y: 0, width: 1, height: 1 }], false)).toThrow('Mark at least one area');
    const many = Array.from({ length: 10_001 }, () => ({ page: 0, x: 0, y: 0, width: 0.1, height: 0.1 }));
    expect(() => redact(mupdf, makePdf(1), many, false)).toThrow('at most 10000');
    expect(() => redact(mupdf, get('14-password-aes256-is-test.pdf'), [{ page: 0, x: 0, y: 0, width: 1, height: 1 }], false)).toThrow('Unlock it first');
  });
});
