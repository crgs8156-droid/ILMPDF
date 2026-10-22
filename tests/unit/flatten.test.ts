import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { flatten } from '../../src/engines/mupdf-flatten';
import { annotate, fillForm, readForm } from '../../src/engines/mupdf-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;
const BOTH = { annotations: true, fields: true };

/** Annotations, widgets, links and page text of every page of a saved PDF. */
function readBack(bytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i) as mupdf.PDFPage;
    pages.push({
      annots: page.getAnnotations().map((a) => a.getType()),
      widgets: page.getWidgets().length,
      links: page.getLinks().map((l) => l.getURI()),
      text: page.toStructuredText('').asText(),
    });
    page.destroy();
  }
  const acroForm = !doc.getTrailer().get('Root').get('AcroForm').isNull();
  doc.destroy();
  return { pages, acroForm };
}

describe('flatten', () => {
  it('bakes form fields and annotations into the page and keeps what they show', async () => {
    const source = await get('31-flatten-form-and-comments.pdf');
    expect(readBack(source).pages[0]!.annots).toHaveLength(5);
    const out = flatten(mupdf, source, BOTH);
    expect(out).toMatchObject({ fields: 5, annotations: 5, signatures: 0 });
    const after = readBack(out.file);
    expect(after.pages[0]!.annots).toEqual([]);
    expect(after.pages[0]!.widgets).toBe(0);
    expect(after.acroForm).toBe(false);
    // The filled-in value and the text box are now part of the page itself.
    expect(after.pages[0]!.text).toContain('Jane Example');
    expect(after.pages[0]!.text).toContain('APPROVED');
    expect(readForm(mupdf, out.file)).toEqual([]);
  });

  it('can flatten only the form fields, keeping comments editable', async () => {
    const out = flatten(mupdf, await get('31-flatten-form-and-comments.pdf'), { annotations: false, fields: true });
    expect(out).toMatchObject({ fields: 5, annotations: 0 });
    const after = readBack(out.file);
    expect(after.pages[0]!.widgets).toBe(0);
    expect(after.pages[0]!.annots).toHaveLength(5);
  });

  it('can flatten only the annotations, keeping the form fillable', async () => {
    const out = flatten(mupdf, await get('31-flatten-form-and-comments.pdf'), { annotations: true, fields: false });
    expect(out).toMatchObject({ fields: 0, annotations: 5 });
    const after = readBack(out.file);
    expect(after.pages[0]!.annots).toEqual([]);
    expect(after.pages[0]!.widgets).toBe(6);
    expect(after.acroForm).toBe(true);
    // The form still works after flattening the comments.
    const refilled = fillForm(mupdf, out.file, [['full_name', 'Someone Else']], false);
    expect(readForm(mupdf, refilled).find((f) => f.name === 'full_name')).toMatchObject({ value: 'Someone Else' });
  });

  it('keeps links clickable', async () => {
    const source = await get('32-flatten-with-links.pdf');
    const before = readBack(source).pages[0]!.links;
    expect(before).toHaveLength(2);
    const out = flatten(mupdf, source, BOTH);
    expect(out.annotations).toBe(10);
    const after = readBack(out.file);
    expect(after.pages.map((p) => p.annots)).toEqual([[], []]);
    expect(after.pages[0]!.links).toEqual(before);
  });

  it('counts a signed signature field so the user can be warned', () => {
    const doc = mupdf.Document.openDocument(makePdf(1), 'application/pdf').asPDF()!;
    const page = doc.loadPage(0) as mupdf.PDFPage;
    const widget = page.createAnnotation('Widget');
    const obj = widget.getObject();
    obj.put('FT', doc.newName('Sig'));
    obj.put('T', doc.newString('Signature1'));
    obj.put('Rect', doc.newArray());
    // A stand-in signature value: enough for the field to count as signed.
    obj.put('V', doc.addObject(doc.newDictionary()));
    const root = doc.getTrailer().get('Root');
    const acro = doc.newDictionary();
    const fields = doc.newArray();
    fields.push(obj);
    acro.put('Fields', fields);
    root.put('AcroForm', acro);
    page.destroy();
    const bytes = new Uint8Array(doc.saveToBuffer('').asUint8Array());
    doc.destroy();
    expect(flatten(mupdf, bytes, BOTH)).toMatchObject({ fields: 1, signatures: 1 });
  });

  it('refuses a PDF with nothing to flatten, a locked PDF and an empty choice', () => {
    expect(() => flatten(mupdf, makePdf(2), BOTH)).toThrow('Nothing to flatten: this PDF has no form fields or annotations');
    const noted = annotate(mupdf, makePdf(1), [{ page: 0, kind: 'rect', color: [1, 0, 0], x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }]);
    expect(() => flatten(mupdf, noted, { annotations: false, fields: true })).toThrow('this PDF has no form fields');
    expect(() => flatten(mupdf, makePdf(1, { encrypted: true }), BOTH)).toThrow('Unlock it first');
    expect(() => flatten(mupdf, makePdf(1), { annotations: false, fields: false })).toThrow('Choose what to flatten');
  });
});
