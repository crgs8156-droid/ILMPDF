import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
import { createOCREngine } from 'tesseract-wasm';
import { PDFDocument, degrees } from 'pdf-lib';
import { extractText } from '../../src/engines/mupdf-ops';
import { addTextLayer } from '../../src/engines/ocr-layer';
import { ocr } from '../../src/engines/ocr-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles, SCAN_LINES } from '../../scripts/make-test-pdfs.mjs';

const lines = SCAN_LINES as string[][];

/** Where MuPDF finds a word on a page, as fractions of the page as shown. */
function findWord(bytes: Uint8Array, pageIndex: number, word: string) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(pageIndex);
  const [x0, y0, x1, y1] = page.getBounds();
  const hits = page.search(word, '');
  doc.destroy();
  const quad = hits[0]?.[0];
  if (!quad) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x: (Math.min(...xs) - x0) / (x1 - x0),
    y: (Math.min(...ys) - y0) / (y1 - y0),
    width: (Math.max(...xs) - Math.min(...xs)) / (x1 - x0),
    height: (Math.max(...ys) - Math.min(...ys)) / (y1 - y0),
  };
}

describe('ocr text layer', () => {
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.04 };

  it('puts each word over its box, upright or on a rotated page', async () => {
    for (const turn of [0, 90, 180, 270]) {
      const doc = await PDFDocument.load(makePdf(1));
      doc.getPage(0).setRotation(degrees(turn));
      const { file, words } = await addTextLayer(await doc.save(), [{ page: 0, words: [{ text: 'Marigold', ...box }] }]);
      expect(words).toBe(1);
      const found = findWord(file, 0, 'Marigold')!;
      expect(found, `rotation ${turn}`).not.toBeNull();
      expect(found.x).toBeCloseTo(box.x, 2);
      expect(found.width).toBeCloseTo(box.width, 2);
      // The glyph box is a little taller than the word box (font ascent and descent).
      expect(Math.abs(found.y + found.height / 2 - (box.y + box.height / 2))).toBeLessThan(box.height);
    }
  });

  it('writes the text invisibly (render mode 3)', async () => {
    const doc0 = await PDFDocument.load(makePdf(1));
    doc0.getPage(0).drawText('Shown');
    const { file } = await addTextLayer(await doc0.save(), [{ page: 0, words: [{ text: 'Hidden', ...box }] }]);
    const doc = mupdf.Document.openDocument(file, 'application/pdf').asPDF()!;
    const contents = doc.findPage(0).get('Contents');
    const streams = Array.from({ length: contents.length }, (_, i) => contents.get(i).readStream().asString());
    doc.destroy();
    expect(streams.join('\n')).toMatch(/\b3 Tr\b/);
    // The page's own drawing is wrapped in q ... Q, so it can't move the words.
    expect(streams[0]!.trim()).toBe('q');
    expect(streams.at(-2)!.trim()).toBe('Q');
    expect(streams.at(-1)).toContain('3 Tr');
  });

  it('drops characters the built-in font cannot write, and empty words', async () => {
    const { file, words } = await addTextLayer(makePdf(1), [
      { page: 0, words: [{ text: 'café→ok', ...box }, { text: '日本', ...box, y: 0.5 }, { text: '  ', ...box, y: 0.6 }] },
    ]);
    expect(words).toBe(1);
    expect(extractText(mupdf, file).pages[0]).toContain('caféok');
  });
});

describe('ocr', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const scan = files.find((f) => f.name === '22-scanned-text.pdf')!.bytes;
  const engine = await createOCREngine({ wasmBinary: await readFile('node_modules/tesseract-wasm/dist/tesseract-core.wasm') });
  engine.loadModel(await readFile('vendor/tessdata/eng.traineddata'));

  it('the test scan really has no text on pages 1 and 3', () => {
    const pages = extractText(mupdf, scan).pages;
    expect(pages[0]).toBe('');
    expect(pages[1]).toContain('real text');
    expect(pages[2]).toBe('');
  });

  it('makes scanned pages searchable, skips the page with text, and reports progress', async () => {
    const progress: string[] = [];
    const out = await ocr(mupdf, engine, scan.slice(), { pages: [], skipText: true }, (d, t) => progress.push(`${d}/${t}`));
    expect(out).toMatchObject({ read: 2, skipped: 1 });
    expect(out.words).toBeGreaterThan(15);
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3']);
    const text = extractText(mupdf, out.file).pages;
    expect(text[0]).toContain('Invoice');
    expect(text[0]).toContain('4821');
    expect(text[2]).toContain('Parcel');
    expect(text[2]).toContain('7395');
    // The typed page is unchanged: its text appears once, not twice.
    expect(text[1]!.match(/real text/g)).toHaveLength(1);
    // The rotated page's words sit where they are seen: "Parcel" starts its line, near the left.
    const parcel = findWord(out.file, 2, 'Parcel')!;
    expect(parcel.x).toBeLessThan(0.2);
    expect(parcel.y).toBeLessThan(0.25);
  });

  it('running it again changes nothing, because every page now has text', async () => {
    const once = await ocr(mupdf, engine, scan.slice(), { pages: [0], skipText: true });
    const twice = await ocr(mupdf, engine, once.file, { pages: [0], skipText: true });
    expect(twice).toMatchObject({ read: 0, skipped: 1, words: 0 });
  });

  it('reads only the chosen pages, and refuses pages that do not exist', async () => {
    const out = await ocr(mupdf, engine, scan.slice(), { pages: [2], skipText: true });
    expect(out.read).toBe(1);
    expect(extractText(mupdf, out.file).pages[0]).toBe('');
    await expect(ocr(mupdf, engine, scan.slice(), { pages: [7], skipText: true })).rejects.toThrow('no page 8');
  });

  it('a blank page gives no words but still saves', async () => {
    const out = await ocr(mupdf, engine, makePdf(1), { pages: [], skipText: true });
    expect(out).toMatchObject({ read: 1, words: 0 });
  });
});
