import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { inspect, open, unlock } from '../../src/engines/mupdf-ops';
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
