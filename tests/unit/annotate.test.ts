import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { PDFDocument, degrees } from 'pdf-lib';
import { annotate, type NewAnnotation } from '../../src/engines/mupdf-ops';
import { MAX_ANNOTATIONS, MAX_INK_POINTS } from '../../src/core/limits';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const RED: [number, number, number] = [1, 0, 0];
const base = { color: RED, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.3 };

/** Every annotation in a saved PDF: its kind, PDF /Rect and the page it is on. */
function readBack(bytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const out: { page: number; type: string; rect: number[]; contents: string; obj: string }[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i) as mupdf.PDFPage;
    for (const a of page.getAnnotations()) {
      const obj = a.getObject().resolve();
      const r = obj.get('Rect');
      const rect = [0, 1, 2, 3].map((k) => r.get(k).asNumber());
      out.push({ page: i, type: a.getType(), rect, contents: a.getContents(), obj: obj.toString() });
    }
    page.destroy();
  }
  doc.destroy();
  return out;
}

describe('annotate', () => {
  it('adds each kind of annotation as a real PDF annotation', () => {
    const items: NewAnnotation[] = [
      { ...base, page: 0, kind: 'text', text: 'Hello', fontSize: 14 },
      { ...base, page: 0, kind: 'highlight' },
      { ...base, page: 0, kind: 'rect' },
      { ...base, page: 1, kind: 'line' },
      { ...base, page: 1, kind: 'note', text: 'Check this' },
    ];
    const found = readBack(annotate(mupdf, makePdf(2), items));
    expect(found.map((a) => [a.page, a.type])).toEqual([
      [0, 'FreeText'],
      [0, 'Highlight'],
      [0, 'Square'],
      [1, 'Line'],
      [1, 'Text'],
    ]);
    expect(found[0]!.contents).toBe('Hello');
    expect(found[0]!.obj).toContain('/Helv 14 Tf');
    expect(found[0]!.obj).not.toContain('/CL');
    expect(found[4]!.contents).toBe('Check this');
    // Nothing identifies who made them.
    for (const a of found) expect(a.obj).not.toMatch(/\/T[ (<]/);
  });

  it('places a box where it was drawn on an unrotated page', () => {
    // makePdf page 0 is 200 x 300 points; the box is 10%-50% across, 10%-30% down.
    const [text] = readBack(annotate(mupdf, makePdf(1), [{ ...base, page: 0, kind: 'text', text: 'x' }]));
    const [x0, y0, x1, y1] = text!.rect;
    expect([x0, x1]).toEqual([expect.closeTo(20, 1), expect.closeTo(100, 1)]);
    // PDF y runs upwards from the bottom: 30% down = 210, 10% down = 270.
    expect([y0, y1]).toEqual([expect.closeTo(210, 1), expect.closeTo(270, 1)]);
  });

  it('places a box where it was drawn on a page turned 90 degrees', async () => {
    const doc = await PDFDocument.load(makePdf(1));
    doc.getPage(0).setRotation(degrees(90));
    const rotated = await doc.save();
    // Shown sideways the page is 300 wide and 200 tall. The box covers the
    // top-left of the screen, which is the bottom-left corner of the page.
    const [text] = readBack(
      annotate(mupdf, rotated, [{ ...base, page: 0, kind: 'text', text: 'x', x1: 0, y1: 0, x2: 0.5, y2: 0.5 }]),
    );
    expect(text!.rect.map((n) => Math.round(n))).toEqual([0, 0, 100, 150]);
  });

  it('keeps a note on the page near the edge', () => {
    const [note] = readBack(annotate(mupdf, makePdf(1), [{ ...base, page: 0, kind: 'note', text: 'n', x1: 1, y1: 1 }]));
    const [x0, y0, x1] = note!.rect;
    expect(x1).toBeLessThanOrEqual(200);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeGreaterThanOrEqual(0);
  });

  it('saves an arrow as a line annotation with an arrowhead at its end', () => {
    const [arrow] = readBack(annotate(mupdf, makePdf(1), [{ ...base, page: 0, kind: 'arrow' }]));
    expect(arrow!.type).toBe('Line');
    expect(arrow!.obj).toMatch(/\/LE\s*\[\s*\/None\s*\/OpenArrow\s*\]/);
  });

  it('saves a freehand drawing as an ink annotation along its points', () => {
    // On the 200 x 300 page: from (20, 30) to (100, 90) to (180, 30), as shown from the top-left.
    const points: [number, number][] = [
      [0.1, 0.1],
      [0.5, 0.3],
      [0.9, 0.1],
    ];
    const [ink] = readBack(annotate(mupdf, makePdf(1), [{ ...base, page: 0, kind: 'ink', points }]));
    expect(ink!.type).toBe('Ink');
    const nums = /\/InkList\s*\[\s*\[([^\]]*)\]/.exec(ink!.obj)![1]!.trim().split(/\s+/).map(Number);
    // PDF y runs upwards: 10% down = 270, 30% down = 210.
    expect(nums.map((n) => Math.round(n))).toEqual([20, 270, 100, 210, 180, 270]);
  });

  it('refuses freehand drawings that are too short or too long', () => {
    const pdf = makePdf(1);
    expect(() => annotate(mupdf, pdf, [{ ...base, page: 0, kind: 'ink', points: [[0.1, 0.1]] }])).toThrow('A drawing is too short.');
    expect(() => annotate(mupdf, pdf, [{ ...base, page: 0, kind: 'ink' }])).toThrow('A drawing is too short.');
    const long = Array.from({ length: MAX_INK_POINTS + 1 }, (_, i): [number, number] => [i / MAX_INK_POINTS, 0.5]);
    expect(() => annotate(mupdf, pdf, [{ ...base, page: 0, kind: 'ink', points: long }])).toThrow(/at most/);
  });

  it('removes hidden control characters from text', () => {
    const [text] = readBack(annotate(mupdf, makePdf(1), [{ ...base, page: 0, kind: 'text', text: 'a‮b\u0007c' }]));
    expect(text!.contents).toBe('abc');
  });

  it('refuses bad input with a clear message', () => {
    const pdf = makePdf(1);
    expect(() => annotate(mupdf, pdf, [])).toThrow('Add at least one annotation first.');
    expect(() => annotate(mupdf, pdf, [{ ...base, page: 3, kind: 'rect' }])).toThrow('This PDF has no page 4.');
    expect(() => annotate(mupdf, pdf, [{ ...base, page: 0, kind: 'text', text: '  ' }])).toThrow('A text box needs some text.');
    expect(() => annotate(mupdf, pdf, [{ ...base, page: 0, kind: 'rect', x2: 0.1 }])).toThrow('A rectangle is too small.');
    const many = Array.from({ length: MAX_ANNOTATIONS + 1 }, () => ({ ...base, page: 0, kind: 'rect' as const }));
    expect(() => annotate(mupdf, pdf, many)).toThrow(/at most/);
  });

  it('asks for a password-protected PDF to be unlocked first', async () => {
    const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
    const locked = files.find((f) => f.name === '14-password-aes256-is-test.pdf')!.bytes;
    expect(() => annotate(mupdf, locked, [{ ...base, page: 0, kind: 'rect' }])).toThrow(/Unlock it first/);
  });
});
