import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts, degrees, rgb } from 'pdf-lib';
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
    const { boxes, fields } = findText(mupdf, sample, ACCOUNT);
    // Page 1's text, the filled-in field on page 1, then page 2's text.
    expect(boxes.map((b) => b.page)).toEqual([0, 0, 1]);
    expect(fields).toBe(1);
    expect(findText(mupdf, sample, 'jane EXAMPLE').boxes).toHaveLength(1);
    for (const b of boxes) {
      for (const n of [b.x, b.y, b.width, b.height]) expect(n).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1);
      expect(b.y + b.height).toBeLessThanOrEqual(1);
    }
  });

  it('gives fractions of the page as shown', async () => {
    // SECRET-WORD sits 40 pt from the left and near the top of a 400 x 300 page.
    const [box] = findText(mupdf, await samplePdf(), 'secret-word').boxes;
    expect(box!.x).toBeCloseTo(40 / 400 - 1 / 400, 2);
    expect(box!.y).toBeLessThan(0.2);
    // Turned a quarter, the same words run down the right-hand side.
    const [turned] = findText(mupdf, await samplePdf(90), 'secret-word').boxes;
    expect(turned!.x).toBeGreaterThan(0.8);
    expect(turned!.height).toBeGreaterThan(turned!.width);
  });

  it('finds nothing for text that is not there, and refuses an empty search', () => {
    expect(findText(mupdf, sample, 'not in this file').boxes).toEqual([]);
    expect(() => findText(mupdf, sample, '   ')).toThrow('Type the text');
    expect(() => findText(mupdf, sample, 'x'.repeat(201))).toThrow('at most 200');
  });
});

describe('redact', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;
  const sample = get('19-redaction-sample.pdf');

  it('removes found text from the file itself, on every page, and keeps the rest', () => {
    const boxes = findText(mupdf, sample, ACCOUNT).boxes;
    const { file, boxes: count, pages } = redact(mupdf, sample, boxes);
    expect([count, pages]).toEqual([3, 2]);
    const text = extractText(mupdf, file).pages.join('\n');
    expect(text).not.toContain(ACCOUNT);
    expect(text).toContain('Account number:');
    expect(text).toContain('Jane Example');
    expect(text).toContain('Public text on page two.');
  });

  it('leaves no copy of the text anywhere in the file bytes', async () => {
    const doc = await samplePdf();
    expect(holds(doc, 'SECRET-WORD')).toBe(true);
    const { file } = redact(mupdf, doc, findText(mupdf, doc, 'SECRET-WORD').boxes);
    expect(holds(file, 'SECRET-WORD')).toBe(false);
    expect(holds(file, 'public line')).toBe(true);
  });

  it('works on rotated pages, using on-screen fractions', async () => {
    for (const turn of [90, 180, 270]) {
      const doc = await samplePdf(turn);
      const { file } = redact(mupdf, doc, findText(mupdf, doc, 'SECRET-WORD').boxes);
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
    const { file } = redact(mupdf, doc, [{ page: 0, x: 290 / 400, y: 10 / 300, width: 80 / 400, height: 80 / 300 }]);
    expect(rawText(file)).not.toMatch(/1 0 0 rg/);
  });

  it('blanks the pixels of an image under a box', async () => {
    const doc = await samplePdf();
    // The image: 300-360 across, 220-280 down.
    const { file } = redact(mupdf, doc, [{ page: 0, x: 290 / 400, y: 210 / 300, width: 80 / 400, height: 80 / 300 }]);
    const pdf = mupdf.Document.openDocument(file, 'application/pdf');
    const pixmap = pdf.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB);
    const at = (x: number, y: number) => {
      const i = (y * pixmap.getWidth() + x) * 3;
      return [...pixmap.getPixels().slice(i, i + 3)];
    };
    expect(at(330, 250)).toEqual([0, 0, 0]); // now the black box, not red
    pdf.destroy();
  });

  it('removes links and form fields under a box, values included', () => {
    const fieldBox: RedactBox = { page: 0, x: 50 / 595.28, y: (841.89 - 425) / 841.89, width: 320 / 595.28, height: 40 / 841.89 };
    const phone = findText(mupdf, sample, '555-0100').boxes;
    const { file } = redact(mupdf, sample, [fieldBox, ...phone]);
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
    expect(author(redact(mupdf, withMeta, [box]).file)).toBe('Jane Example');
    expect(author(redact(mupdf, withMeta, [box], { stripMetadata: true }).file)).toBeUndefined();
  });

  it('clips boxes to the page and ignores ones off any page', async () => {
    const doc = await samplePdf();
    const { boxes } = redact(mupdf, doc, [
      { page: 0, x: -1, y: -1, width: 1.2, height: 1.2 },
      { page: 5, x: 0, y: 0, width: 1, height: 1 },
      { page: 0.5, x: 0, y: 0, width: 1, height: 1 },
    ]);
    expect(boxes).toBe(1);
  });

  it('marks a filled-in field by its value, so redacting removes it', () => {
    const { boxes, fields } = findText(mupdf, sample, 'account 0000');
    expect(fields).toBe(1);
    const { file } = redact(mupdf, sample, boxes, { phrases: ['account 0000'] });
    expect(holds(file, 'Account 0000')).toBe(false);
    expect((mupdf.Document.openDocument(file, 'application/pdf').asPDF()!.loadPage(0) as mupdf.PDFPage).getWidgets()).toHaveLength(0);
  });

  it('removes a redacted field everywhere it is shown', async () => {
    const doc = await PDFDocument.create();
    const form = doc.getForm();
    const field = form.createTextField('shared');
    field.setText('TOP-SECRET-VALUE');
    const [one, two] = [doc.addPage([400, 300]), doc.addPage([400, 300])];
    field.addToPage(one, { x: 40, y: 200, width: 200, height: 30 });
    field.addToPage(two, { x: 40, y: 200, width: 200, height: 30 });
    const bytes = await doc.save();
    const { boxes } = findText(mupdf, bytes, 'top-secret-value');
    expect(boxes.map((b) => b.page)).toEqual([0, 1]);
    // Only the first page's copy is marked; the second goes too.
    const { file } = redact(mupdf, bytes, [boxes[0]!]);
    expect(holds(file, 'TOP-SECRET-VALUE')).toBe(false);
    const pdf = mupdf.Document.openDocument(file, 'application/pdf').asPDF()!;
    expect([0, 1].map((i) => (pdf.loadPage(i) as mupdf.PDFPage).getWidgets().length)).toEqual([0, 0]);
  });

  it('removes bookmarks that mention a searched phrase, keeping the ones under them', () => {
    const { file, bookmarks } = redact(mupdf, sample, findText(mupdf, sample, 'Jane Example').boxes, { phrases: ['Jane Example'] });
    expect(bookmarks).toBe(1);
    const pdf = mupdf.Document.openDocument(file, 'application/pdf');
    type Item = { title: string | undefined; down?: Item[] | undefined };
    const titles = (items: Item[] = []): unknown[] => items.map((i) => (i.down ? [i.title, titles(i.down)] : i.title));
    expect(titles(pdf.loadOutline() ?? [])).toEqual([['Letter', ['Contact details']], 'Page two']);
    // The counts that say how many bookmarks show are right again.
    const outlines = pdf.asPDF()!.getTrailer().get('Root', 'Outlines');
    expect([outlines.get('Count').asNumber(), outlines.get('First').get('Count').asNumber()]).toEqual([3, 1]);
  });

  it('uses the words under a drawn box to find bookmarks', () => {
    // A box over "Name: Jane Example" (14 pt text at 730 pt up an A4 page).
    const box: RedactBox = { page: 0, x: 50 / 595.28, y: (841.89 - 748) / 841.89, width: 300 / 595.28, height: 26 / 841.89 };
    expect(redact(mupdf, sample, [box]).bookmarks).toBe(1);
  });

  it('removes attached files whose contents mention the redacted text, and names the ones it cannot check', () => {
    const before = mupdf.Document.openDocument(sample, 'application/pdf').asPDF()!;
    expect(Object.keys(before.getEmbeddedFiles())).toEqual(['account-details.txt', 'public-notes.txt', 'scan.png']);
    const { file, attachments, unchecked } = redact(mupdf, sample, findText(mupdf, sample, ACCOUNT).boxes, { phrases: [ACCOUNT] });
    expect([attachments, unchecked]).toEqual([1, ['scan.png']]);
    const after = mupdf.Document.openDocument(file, 'application/pdf').asPDF()!;
    expect(Object.keys(after.getEmbeddedFiles())).toEqual(['public-notes.txt', 'scan.png']);
    expect(holds(file, 'belongs to the sample letter')).toBe(false);
    expect(holds(file, 'Nothing private here.')).toBe(true);
  });

  it('matches attached files by description, and can remove every attached file', () => {
    const corner: RedactBox = { page: 0, x: 0, y: 0, width: 0.01, height: 0.01 };
    expect(redact(mupdf, sample, [corner], { phrases: ['public NOTES'] }).attachments).toBe(1);
    const { file, attachments, unchecked } = redact(mupdf, sample, [corner], { removeAllAttachments: true });
    expect([attachments, unchecked]).toEqual([3, []]);
    expect(Object.keys(mupdf.Document.openDocument(file, 'application/pdf').asPDF()!.getEmbeddedFiles())).toEqual([]);
  });

  it('looks inside attached PDFs and paperclip comments', async () => {
    const doc = await PDFDocument.load(await samplePdf());
    await doc.attach(await samplePdf(), 'inner.pdf', { mimeType: 'application/pdf' });
    const bytes = await doc.save();
    const result = redact(mupdf, bytes, findText(mupdf, bytes, 'SECRET-WORD').boxes, { phrases: ['SECRET-WORD'] });
    expect([result.attachments, result.unchecked]).toEqual([1, []]);

    // A paperclip comment holding a text file, added with MuPDF.
    const pdf = mupdf.Document.openDocument(await samplePdf(), 'application/pdf').asPDF()!;
    const page = pdf.loadPage(0) as mupdf.PDFPage;
    const clip = page.createAnnotation('FileAttachment');
    clip.setRect([10, 10, 30, 30]);
    clip.setFileSpec(pdf.addEmbeddedFile('secret.txt', 'text/plain', new TextEncoder().encode('SECRET-WORD again'), new Date(0), new Date(0)));
    clip.update();
    const withClip = new Uint8Array(pdf.saveToBuffer({}).asUint8Array());
    const out = redact(mupdf, withClip, findText(mupdf, withClip, 'SECRET-WORD').boxes, { phrases: ['SECRET-WORD'] });
    expect(out.attachments).toBe(1);
    expect(holds(out.file, 'SECRET-WORD again')).toBe(false);
  });

  it('removes comments anywhere that mention the redacted text, keeping the others', async () => {
    const pdf = mupdf.Document.openDocument(await samplePdf(), 'application/pdf').asPDF()!;
    const page = pdf.loadPage(0) as mupdf.PDFPage;
    // Bottom right, far from the secret line at the top.
    for (const [text, y] of [['Reminder: SECRET-WORD is private', 200], ['Nothing to hide', 240]] as const) {
      const note = page.createAnnotation('Text');
      note.setRect([360, y, 380, y + 20]);
      note.setContents(text);
      note.update();
    }
    const box = page.createAnnotation('FreeText');
    box.setRect([200, 150, 380, 180]);
    box.setContents('see secret-word above');
    box.update();
    const bytes = new Uint8Array(pdf.saveToBuffer({}).asUint8Array());
    const { file, comments } = redact(mupdf, bytes, findText(mupdf, bytes, 'SECRET-WORD').boxes, { phrases: ['SECRET-WORD'] });
    expect(comments).toBe(2);
    expect(holds(file, 'is private')).toBe(false);
    expect(holds(file, 'see secret-word above')).toBe(false);
    expect(holds(file, 'Nothing to hide')).toBe(true);
  });

  it('removes the stored thumbnail of a redacted page', async () => {
    const doc = await PDFDocument.load(await samplePdf());
    // A 1 x 1 grey "picture of the page", as older Acrobat versions stored.
    const thumb = doc.context.stream(new Uint8Array([128]), { Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
    doc.getPage(0).node.set(PDFName.of('Thumb'), doc.context.register(thumb));
    const bytes = await doc.save();
    const { file } = redact(mupdf, bytes, findText(mupdf, bytes, 'SECRET-WORD').boxes);
    const after = mupdf.Document.openDocument(file, 'application/pdf').asPDF()!;
    expect(after.findPage(0).get('Thumb').isNull()).toBe(true);
  });

  it('takes hidden characters out of the names of attached files it cannot check', async () => {
    const doc = await PDFDocument.load(await samplePdf());
    // U+202E flips the text after it, so "gnp.exe" would show as "exe.png".
    await doc.attach(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), 'photo\u202Egnp.exe', { mimeType: 'image/png' });
    const bytes = await doc.save();
    const { unchecked } = redact(mupdf, bytes, findText(mupdf, bytes, 'SECRET-WORD').boxes);
    expect(unchecked).toEqual(['photognp.exe']);
  });

  it('copes with a bookmark list that loops back on itself', async () => {
    const doc = await PDFDocument.load(sample);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const last = outlines.get(PDFName.of('Last')) as PDFRef;
    // "Page two" points back to "Letter" as the next bookmark.
    doc.context.lookup(last, PDFDict).set(PDFName.of('Next'), outlines.get(PDFName.of('First'))!);
    const looped = await doc.save();
    const { bookmarks } = redact(mupdf, looped, findText(mupdf, looped, 'Jane Example').boxes, { phrases: ['Jane Example'] });
    expect(bookmarks).toBe(1);
  });

  it('refuses no boxes, too many boxes and locked files', () => {
    expect(() => redact(mupdf, makePdf(1), [])).toThrow('Mark at least one area');
    expect(() => redact(mupdf, makePdf(1), [{ page: 3, x: 0, y: 0, width: 1, height: 1 }])).toThrow('Mark at least one area');
    const many = Array.from({ length: 10_001 }, () => ({ page: 0, x: 0, y: 0, width: 0.1, height: 0.1 }));
    expect(() => redact(mupdf, makePdf(1), many)).toThrow('at most 10000');
    expect(() => redact(mupdf, get('14-password-aes256-is-test.pdf'), [{ page: 0, x: 0, y: 0, width: 1, height: 1 }])).toThrow('Unlock it first');
  });
});
