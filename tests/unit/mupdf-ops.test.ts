import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { cleanText, compress, extractText, fillForm, inspect, open, protect, readForm, repair, unlock } from '../../src/engines/mupdf-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

describe('mupdf-ops', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  it('reads page count of a normal PDF', () => {
    expect(inspect(mupdf, makePdf(6))).toEqual({ pages: 6, encrypted: false, needsPassword: false });
  });

  it('sees that an AES-256 file needs a password', () => {
    expect(inspect(mupdf, get('14-password-aes256-is-test.pdf'))).toMatchObject({ encrypted: true, needsPassword: true });
  });

  it('accepts the right password and refuses a wrong one', () => {
    const doc = open(mupdf, get('14-password-aes256-is-test.pdf'), 'test');
    expect(doc.countPages()).toBe(5);
    doc.destroy();
    expect(() => open(mupdf, get('14-password-aes256-is-test.pdf'), 'wrong')).toThrow('That password is not correct.');
  });

  it('rejects a file that is not a PDF', () => {
    expect(() => inspect(mupdf, new TextEncoder().encode('hello'))).toThrow();
  });
});

describe('unlock', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  for (const name of ['10-password-is-test.pdf', '14-password-aes256-is-test.pdf']) {
    it(`removes the password from ${name}`, async () => {
      const out = unlock(mupdf, get(name), 'test');
      expect(inspect(mupdf, out)).toMatchObject({ encrypted: false, needsPassword: false });
      const doc = await PDFDocument.load(out);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });
  }

  it('refuses a wrong password', () => {
    expect(() => unlock(mupdf, get('14-password-aes256-is-test.pdf'), 'nope')).toThrow('That password is not correct.');
  });

  it('removes restrictions only with the owner password', () => {
    const restricted = get('18-restricted-owner-password-is-owner-test.pdf');
    expect(inspect(mupdf, restricted)).toMatchObject({ encrypted: true, needsPassword: false });
    expect(() => unlock(mupdf, restricted, 'wrong')).toThrow(/owner password/);
    expect(inspect(mupdf, unlock(mupdf, restricted, 'owner-test'))).toMatchObject({ encrypted: false });
  });

  it('says so when a PDF has no password', () => {
    expect(() => unlock(mupdf, makePdf(2), 'x')).toThrow(/isn't password-protected/);
  });

  it('refuses a PDF over the page limit once the password is accepted', () => {
    // Encrypted straight with MuPDF, because protect() itself now refuses it.
    const doc = open(mupdf, makePdf(5001));
    const locked = new Uint8Array(doc.saveToBuffer({ encrypt: 'aes-256', 'user-password': 'test', 'owner-password': 'owner' }).asUint8Array());
    doc.destroy();
    expect(() => unlock(mupdf, locked, 'test')).toThrow(/more than 5000 pages/);
  });
});

describe('protect', () => {
  const all = { allowPrint: true, allowCopy: true, allowEdit: true };

  it('makes an AES-256 file that opens only with the password', () => {
    const out = protect(mupdf, makePdf(3), { password: 'correct horse', ...all });
    expect(inspect(mupdf, out)).toMatchObject({ encrypted: true, needsPassword: true });
    const doc = mupdf.Document.openDocument(out, 'application/pdf');
    expect(doc.getMetaData(mupdf.Document.META_ENCRYPTION)).toContain('AES');
    expect(doc.authenticatePassword('wrong')).toBe(0);
    expect(doc.authenticatePassword('correct horse')).not.toBe(0);
    expect(doc.countPages()).toBe(3);
    doc.destroy();
  });

  it('round-trips with unlock', () => {
    const out = protect(mupdf, makePdf(2), { password: 'pässwörd ✓', ...all });
    expect(inspect(mupdf, unlock(mupdf, out, 'pässwörd ✓'))).toEqual({ pages: 2, encrypted: false, needsPassword: false });
  });

  it('keeps commas and equals signs in the password instead of reading them as options', () => {
    const tricky = 'a,encrypt=no,user-password=x';
    const out = protect(mupdf, makePdf(1), { password: tricky, ...all });
    const doc = mupdf.Document.openDocument(out, 'application/pdf');
    expect(doc.authenticatePassword('x')).toBe(0);
    expect(doc.authenticatePassword(tricky)).not.toBe(0);
    doc.destroy();
  });

  it('applies the chosen restrictions', () => {
    const out = protect(mupdf, makePdf(1), { password: 'pw', allowPrint: true, allowCopy: false, allowEdit: false });
    const doc = mupdf.Document.openDocument(out, 'application/pdf');
    doc.authenticatePassword('pw');
    expect(doc.hasPermission('print')).toBe(true);
    expect(doc.hasPermission('copy')).toBe(false);
    expect(doc.hasPermission('edit')).toBe(false);
    doc.destroy();
  });

  it('refuses an empty password and an already locked file', () => {
    expect(() => protect(mupdf, makePdf(1), { password: '', ...all })).toThrow('Enter a password.');
    const locked = protect(mupdf, makePdf(1), { password: 'a', ...all });
    expect(() => protect(mupdf, locked, { password: 'b', ...all })).toThrow(/already has a password/);
  });

  it('refuses a PDF over the page limit', () => {
    expect(() => protect(mupdf, makePdf(5001), { password: 'a', ...all })).toThrow(/more than 5000 pages/);
  });
});

describe('repair', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  it('rebuilds a broken cross-reference table', async () => {
    const result = repair(mupdf, get('16-repairable.pdf'));
    expect(result).toMatchObject({ pages: 3, repaired: true });
    // The fixed copy opens cleanly, with no repair needed, in both engines.
    const doc = open(mupdf, result.file);
    expect(doc.wasRepaired()).toBe(false);
    doc.destroy();
    expect((await PDFDocument.load(result.file)).getPageCount()).toBe(3);
  });

  it('recovers the pages of a file cut off near the end', () => {
    const five = get('02-five-pages.pdf');
    const result = repair(mupdf, five.slice(0, Math.floor(five.length * 0.9)));
    expect(result).toMatchObject({ pages: 5, repaired: true });
    expect(inspect(mupdf, result.file).pages).toBe(5);
  });

  it('rewrites an undamaged file and says no repair was needed', () => {
    expect(repair(mupdf, makePdf(4))).toMatchObject({ pages: 4, repaired: false });
  });

  it('gives a clear message when nothing can be recovered', () => {
    expect(() => repair(mupdf, get('11-damaged.pdf'))).toThrow('too damaged to repair');
    expect(() => repair(mupdf, get('12-not-really-a-pdf.pdf'))).toThrow();
  });

  it('asks for a password-protected file to be unlocked first', () => {
    expect(() => repair(mupdf, get('14-password-aes256-is-test.pdf'))).toThrow('Unlock it first');
  });

  it('keeps the restrictions on a restricted file', () => {
    const result = repair(mupdf, get('18-restricted-owner-password-is-owner-test.pdf'));
    expect(inspect(mupdf, result.file)).toMatchObject({ encrypted: true, needsPassword: false });
  });
});

describe('compress', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  // Renders page 1 small and returns its RGB pixels, to check that a
  // compressed page still looks the same (and is not flipped or blank).
  const look = (bytes: Uint8Array) => {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(0.25, 0.25), mupdf.ColorSpace.DeviceRGB, false);
    const pixels = Array.from(pix.getPixels());
    doc.destroy();
    return pixels;
  };
  const difference = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length;

  it('makes a scanned-style file much smaller at every level, more so at stronger ones', () => {
    const scanned = get('17-scanned-heavy.pdf');
    const light = compress(mupdf, scanned, 'light');
    const recommended = compress(mupdf, scanned, 'recommended');
    const strong = compress(mupdf, scanned, 'strong');
    expect(light.images).toBe(0);
    expect(recommended).toMatchObject({ before: scanned.length, images: 3 });
    expect(recommended.after).toBeLessThan(scanned.length * 0.5);
    expect(strong.after).toBeLessThan(recommended.after);
    expect(strong.after).toBeLessThan(scanned.length * 0.15);
    expect(inspect(mupdf, strong.file).pages).toBe(3);
  });

  it('keeps pages looking the same (images upright, not blank)', () => {
    for (const name of ['09-large-images.pdf', '17-scanned-heavy.pdf']) {
      const original = get(name);
      const out = compress(mupdf, original, 'recommended').file;
      expect(out).not.toBe(original);
      expect(difference(look(original), look(out))).toBeLessThan(8);
    }
  });

  it('returns the original bytes when it cannot make a file smaller', () => {
    const tiny = makePdf(1);
    const result = compress(mupdf, tiny, 'strong');
    expect(result.file).toBe(tiny);
    expect(result.after).toBe(result.before);
  });

  it('keeps form fields working', async () => {
    const form = get('15-form.pdf');
    const out = compress(mupdf, form, 'strong').file;
    const before = (await PDFDocument.load(form)).getForm().getFields().length;
    expect((await PDFDocument.load(out)).getForm().getFields().length).toBe(before);
  });

  it('keeps restrictions, and asks for password files to be unlocked first', () => {
    const restricted = compress(mupdf, get('18-restricted-owner-password-is-owner-test.pdf'), 'recommended');
    expect(inspect(mupdf, restricted.file)).toMatchObject({ encrypted: true, needsPassword: false });
    expect(() => compress(mupdf, get('14-password-aes256-is-test.pdf'), 'light')).toThrow('Unlock it first');
  });
});

describe('forms', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const form = files.find((f) => f.name === '15-form.pdf')!.bytes;
  const pageText = (bytes: Uint8Array) => {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const text = doc.loadPage(0).toStructuredText('').asText();
    doc.destroy();
    return text;
  };
  const filled: [string, string | boolean][] = [
    ['full_name', 'Ada Lovelace'],
    ['email', 'ada@example.com'],
    ['subscribe', true],
    ['plan', 'Pro'],
    ['size', 'Large'],
  ];

  it('lists every field with its kind and options', () => {
    const fields = readForm(mupdf, form);
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ['full_name', 'text'],
      ['email', 'text'],
      ['subscribe', 'checkbox'],
      ['plan', 'choice'],
      ['size', 'radio'],
    ]);
    expect(fields.find((f) => f.name === 'plan')!.options).toEqual(['Free', 'Pro', 'Team']);
    expect(fields.find((f) => f.name === 'size')!.options).toEqual(['Small', 'Large']);
  });

  it('fills fields and keeps them editable', async () => {
    const out = fillForm(mupdf, form, filled, false);
    const pdfForm = (await PDFDocument.load(out)).getForm();
    expect(pdfForm.getTextField('full_name').getText()).toBe('Ada Lovelace');
    expect(pdfForm.getCheckBox('subscribe').isChecked()).toBe(true);
    expect(pdfForm.getDropdown('plan').getSelected()).toEqual(['Pro']);
    expect(pdfForm.getRadioGroup('size').getSelected()).toBe('Large');
    // And MuPDF reads back what it wrote.
    const again = readForm(mupdf, out);
    expect(again.find((f) => f.name === 'size')!.value).toBe('Large');
    expect(again.find((f) => f.name === 'subscribe')!.checked).toBe(true);
  });

  it('flattens: values become part of the page and the fields are gone', async () => {
    const out = fillForm(mupdf, form, filled, true);
    expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(0);
    expect(readForm(mupdf, out)).toEqual([]);
    const text = pageText(out);
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('Pro');
  });

  it('ignores unknown fields, wrong value types and options that do not exist', () => {
    const out = fillForm(mupdf, form, [['__proto__', 'x'], ['subscribe', 'yes'], ['plan', 'Enterprise'], ['email', 42 as unknown as string]], false);
    const fields = readForm(mupdf, out);
    expect(fields.find((f) => f.name === 'subscribe')!.checked).toBe(false);
    expect(fields.find((f) => f.name === 'plan')!.value).not.toBe('Enterprise');
    expect(fields.find((f) => f.name === 'email')!.value).toBe('');
  });

  it('finds no fields in an ordinary PDF and refuses password files', () => {
    expect(readForm(mupdf, makePdf(2))).toEqual([]);
    expect(() => readForm(mupdf, files.find((f) => f.name === '14-password-aes256-is-test.pdf')!.bytes)).toThrow('Unlock it first');
  });
});

describe('extractText', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  it('reads the text of every page, in page order', () => {
    const { pages, chars } = extractText(mupdf, get('02-five-pages.pdf'));
    expect(pages).toHaveLength(5);
    pages.forEach((text, i) => expect(text).toContain(`Page ${i + 1} of 5`));
    expect(chars).toBeGreaterThan(0);
  });

  it('reads rotated pages too', () => {
    const { pages } = extractText(mupdf, get('07-rotated-pages.pdf'));
    pages.forEach((text, i) => expect(text).toContain(`Page ${i + 1} of ${pages.length}`));
  });

  it('finds no text in a scanned file', () => {
    expect(extractText(mupdf, get('17-scanned-heavy.pdf')).chars).toBe(0);
  });

  it('gives empty pages for a PDF with no content', () => {
    expect(extractText(mupdf, makePdf(3))).toEqual({ pages: ['', '', ''], chars: 0 });
  });

  it('reads a restricted file, and asks for password files to be unlocked first', () => {
    expect(extractText(mupdf, get('18-restricted-owner-password-is-owner-test.pdf')).chars).toBeGreaterThan(0);
    expect(() => extractText(mupdf, get('14-password-aes256-is-test.pdf'))).toThrow('Unlock it first');
  });

  it('removes control characters and hidden direction marks', () => {
    expect(cleanText('a\u0000b\u0007c\r\nd\re\tf\u202eg\u2066h\u2069  \n\n')).toBe('abc\nd\ne\tfgh');
  });
});
