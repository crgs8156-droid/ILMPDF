import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
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
