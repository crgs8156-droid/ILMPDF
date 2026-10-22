import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { removePages } from '../../src/engines/mupdf-pages';
import { insertPages } from '../../src/engines/pagetools-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

/** What Remove blank pages must keep: pages, form, bookmarks, attachments, title. */
function readBack(bytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const form = doc.getTrailer().get('Root').get('AcroForm');
  const fields = form.isDictionary() ? form.get('Fields') : null;
  const widgets: string[][] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i) as mupdf.PDFPage;
    widgets.push(page.getWidgets().map((w) => w.getName()));
    page.destroy();
  }
  const result = {
    pages: doc.countPages(),
    fields: fields?.isArray() ? fields.length : null,
    widgets,
    bookmarks: (doc.loadOutline() ?? []).map((o) => ({ title: o.title, page: o.page })),
    attachments: Object.keys(doc.getEmbeddedFiles()).sort(),
    title: doc.getMetaData('info:Title'),
  };
  doc.destroy();
  return result;
}

describe('removePages', () => {
  it('keeps the form, bookmarks, attached files and title (unlike Organize)', async () => {
    const source = await get('19-redaction-sample.pdf');
    const before = readBack(source);
    // Add a blank page between pages 1 and 2, then remove it again.
    const withBlank = await insertPages(source, { at: 1, blankCount: 1 });
    const after = readBack(removePages(mupdf, withBlank, [1]));
    expect(after).toEqual(before);
    expect(after.fields).toBe(1);
    expect(after.attachments.length).toBeGreaterThan(0);
    expect(after.bookmarks.map((b) => b.page)).toEqual([0, 1]);
  });

  it('turns a bookmark to a removed page into a heading that goes nowhere', async () => {
    const after = readBack(removePages(mupdf, await get('19-redaction-sample.pdf'), [1]));
    expect(after.pages).toBe(1);
    expect(after.bookmarks).toEqual([
      { title: 'Letter', page: 0 },
      { title: 'Page two', page: undefined },
    ]);
  });

  it('drops form fields that were only on a removed page', async () => {
    const form = await insertPages(await get('15-form.pdf'), { at: 1, blankCount: 1 });
    expect(readBack(form).fields).toBe(5);
    const after = readBack(removePages(mupdf, form, [0]));
    expect(after).toMatchObject({ pages: 1, fields: 0, widgets: [[]] });
  });

  it('removes several pages and ignores repeats', async () => {
    const after = readBack(removePages(mupdf, makePdf(5), [3, 1, 3]));
    expect(after.pages).toBe(3);
  });

  it('refuses to remove every page, or a page that does not exist', () => {
    expect(() => removePages(mupdf, makePdf(2), [0, 1])).toThrow('Keep at least one page');
    expect(() => removePages(mupdf, makePdf(2), [2])).toThrow('out of range');
    expect(() => removePages(mupdf, makePdf(2), [0.5])).toThrow('out of range');
  });
});
