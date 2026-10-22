import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { degrees, PDFDocument } from 'pdf-lib';
import { batesLabel, fillTemplate, localDate } from '../../src/core/header-text';
import { addHeaderFooter, type HeaderFooterOptions } from '../../src/engines/header-footer';
import { extractText } from '../../src/engines/mupdf-ops';
import { makePdf } from '../fixtures/make-pdf';

const BATES = { prefix: 'ABC', suffix: '', start: 1, digits: 6 };

function options(over: Partial<HeaderFooterOptions> = {}): HeaderFooterOptions {
  return { texts: {}, fontSize: 10, margin: 24, pages: [], fileName: 'report', date: '2026-10-21', bates: BATES, ...over };
}

/** Each line of text MuPDF finds on a page, with where it sits as shown (top-left origin). */
type Line = { text: string; x: number; y: number; w: number; h: number; pageW: number; pageH: number };
function lines(bytes: Uint8Array, index: number): Line[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(index);
  const [, , pageW, pageH] = page.getBounds();
  const json = JSON.parse(page.toStructuredText('').asJSON()) as {
    blocks: { lines?: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] }[];
  };
  return json.blocks.flatMap((b) => b.lines ?? []).map((l) => ({ text: l.text, ...l.bbox, pageW: pageW!, pageH: pageH! }));
}

describe('header text codes', () => {
  const values = { page: 3, total: 9, file: 'report', date: '2026-10-21', bates: 'ABC000003' };

  it('fills in every code, in any case', () => {
    expect(fillTemplate('Page {page} of {TOTAL}', values)).toBe('Page 3 of 9');
    expect(fillTemplate('{file} {date} {Bates}', values)).toBe('report 2026-10-21 ABC000003');
  });

  it('leaves unknown codes and plain braces alone', () => {
    expect(fillTemplate('{nope} {} {page', values)).toBe('{nope} {} {page');
  });

  it('keeps text to one line and caps its length', () => {
    expect(fillTemplate('a\nb\r\tc', values)).toBe('a b c');
    expect(fillTemplate('x'.repeat(500), values)).toHaveLength(200);
  });

  it('pads Bates numbers and adds the prefix and suffix', () => {
    expect(batesLabel(BATES, 123)).toBe('ABC000123');
    expect(batesLabel({ prefix: 'X-', suffix: '-CONF', start: 0, digits: 3 }, 7)).toBe('X-007-CONF');
    expect(batesLabel({ ...BATES, digits: 2 }, 12345)).toBe('ABC12345');
    expect(batesLabel({ ...BATES, digits: Number.NaN }, 5)).toBe('ABC5');
  });

  it('formats the local date', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('addHeaderFooter', () => {
  it('stamps every page and keeps the page sizes', async () => {
    const out = await addHeaderFooter(makePdf(3), options({ texts: { 'bottom-center': 'Page {page} of {total}', 'top-left': '{file}' } }));
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([200, 201, 202]);
    const text = extractText(mupdf, out).pages;
    expect(text[0]).toContain('Page 1 of 3');
    expect(text[2]).toContain('Page 3 of 3');
    expect(text[1]).toContain('report');
  });

  it('counts Bates numbers only on the chosen pages', async () => {
    const out = await addHeaderFooter(
      makePdf(4),
      options({ texts: { 'bottom-right': '{bates}' }, pages: [1, 2, 3], bates: { ...BATES, start: 41 } }),
    );
    const text = extractText(mupdf, out).pages;
    expect(text[0]).toBe('');
    expect(text.slice(1)).toEqual(['ABC000041', 'ABC000042', 'ABC000043']);
  });

  it('puts each spot in the right place on the page', async () => {
    const out = await addHeaderFooter(
      makePdf(1),
      options({ texts: { 'top-left': 'TL', 'top-right': 'TR', 'bottom-center': 'BC' } }),
    );
    const found = Object.fromEntries(lines(out, 0).map((l) => [l.text, l]));
    // Precision -0.5 allows about 1.5 points, for the gap glyphs leave around their outlines.
    expect(found.TL!.x).toBeCloseTo(24, -0.5);
    expect(found.TL!.y).toBeLessThan(40);
    expect(found.TR!.x + found.TR!.w).toBeCloseTo(200 - 24, -0.5);
    expect(found.BC!.y).toBeGreaterThan(300 - 40);
    expect(found.BC!.x + found.BC!.w / 2).toBeCloseTo(100, -0.5);
  });

  it('reads upright at the top of rotated pages', async () => {
    const src = await PDFDocument.create();
    for (const turn of [0, 90, 180, 270]) src.addPage([300, 500]).setRotation(degrees(turn));
    const out = await addHeaderFooter(await src.save(), options({ texts: { 'top-left': 'Header here' } }));
    for (let i = 0; i < 4; i++) {
      const [line] = lines(out, i);
      expect(line!.text, `page ${i + 1}`).toBe('Header here');
      // Near the top-left corner of the page as shown, and wider than tall (upright).
      expect(line!.x, `page ${i + 1}`).toBeCloseTo(24, -0.5);
      expect(line!.y, `page ${i + 1}`).toBeLessThan(40);
      expect(line!.w, `page ${i + 1}`).toBeGreaterThan(line!.h);
    }
  });

  it('is not thrown off by page content that leaves the drawing scaled', async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([200, 300]);
    // A content stream that ends with the coordinate system scaled and not restored.
    // pdf-lib wraps a loaded page's own content in q ... Q, so our text is unaffected.
    page.node.set(src.context.obj('Contents'), src.context.register(src.context.stream('0.5 0 0 0.5 0 0 cm')));
    const out = await addHeaderFooter(await src.save(), options({ texts: { 'top-right': 'TR' } }));
    const [line] = lines(out, 0);
    expect(line!.x + line!.w).toBeCloseTo(200 - 24, -0.5);
  });

  it('replaces characters the font lacks in the file name', async () => {
    const out = await addHeaderFooter(makePdf(1), options({ texts: { 'top-center': '{file}' }, fileName: 'naïve 文件' }));
    expect(extractText(mupdf, out).pages[0]).toBe('naïve ??');
  });

  it('asks for text when every box is empty', async () => {
    await expect(addHeaderFooter(makePdf(1), options({ texts: { 'top-left': '   ' } }))).rejects.toThrow(/at least one/);
  });

  it('refuses text the built-in font cannot show', async () => {
    await expect(addHeaderFooter(makePdf(1), options({ texts: { 'top-left': '秘密' } }))).rejects.toThrow(/basic Latin/);
    await expect(
      addHeaderFooter(makePdf(1), options({ texts: { 'top-left': '{bates}' }, bates: { ...BATES, prefix: '秘' } })),
    ).rejects.toThrow(/Bates prefix/);
  });

  it('rejects a page that does not exist', async () => {
    await expect(addHeaderFooter(makePdf(2), options({ texts: { 'top-left': 'x' }, pages: [5] }))).rejects.toThrow(/out of range/);
  });
});
