import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { inspect, open, protect, unlock } from '../../src/engines/mupdf-ops';
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
});
