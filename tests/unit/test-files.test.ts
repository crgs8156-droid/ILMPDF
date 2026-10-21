import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

type TestFile = { name: string; purpose: string; bytes: Uint8Array };

describe('make-test-pdfs', async () => {
  const files: TestFile[] = await buildTestFiles();
  const byName = Object.fromEntries(files.map((f) => [f.name, f.bytes]));

  it('builds every file with a purpose', () => {
    expect(files.length).toBe(27);
    for (const f of files) {
      expect(f.bytes.length).toBeGreaterThan(0);
      expect(f.purpose.length).toBeGreaterThan(0);
    }
  });

  it('makes valid PDFs with the stated page counts', async () => {
    const expected: Record<string, number> = {
      '01-one-page.pdf': 1,
      '02-five-pages.pdf': 5,
      '03-twelve-pages.pdf': 12,
      '04-fifty-pages.pdf': 50,
      '05-three-hundred-pages.pdf': 300,
      '06-mixed-sizes.pdf': 5,
      '07-rotated-pages.pdf': 4,
      '08-with-metadata.pdf': 2,
      '09-large-images.pdf': 2,
      '15-form.pdf': 1,
      '17-scanned-heavy.pdf': 3,
      '19-redaction-sample.pdf': 2,
      '20-with-scripts.pdf': 3,
      '21-form-with-scripts.pdf': 1,
      '22-scanned-text.pdf': 3,
      '29-images-mixed.pdf': 3,
      '30-no-images.pdf': 2,
    };
    for (const [name, count] of Object.entries(expected)) {
      const doc = await PDFDocument.load(byName[name]!);
      expect(doc.getPageCount(), name).toBe(count);
    }
  });

  it('includes the metadata, the rotations and a really encrypted file', async () => {
    const meta = await PDFDocument.load(byName['08-with-metadata.pdf']!, { updateMetadata: false });
    expect(meta.getAuthor()).toBe('Jane Example');
    const rotated = await PDFDocument.load(byName['07-rotated-pages.pdf']!);
    expect(rotated.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 180, 270]);
    const locked = await PDFDocument.load(byName['10-password-is-test.pdf']!, { ignoreEncryption: true });
    expect(locked.isEncrypted).toBe(true);
    const aes = await PDFDocument.load(byName['14-password-aes256-is-test.pdf']!, { ignoreEncryption: true });
    expect(aes.isEncrypted).toBe(true);
    const form = await PDFDocument.load(byName['15-form.pdf']!);
    expect(form.getForm().getFields().map((f) => f.getName())).toEqual(['full_name', 'email', 'subscribe', 'plan', 'size']);
  });

  it('makes the broken files actually broken', async () => {
    await expect(PDFDocument.load(byName['11-damaged.pdf']!)).rejects.toThrow();
    expect(new TextDecoder().decode(byName['12-not-really-a-pdf.pdf']!.slice(0, 5))).not.toBe('%PDF-');
  });
});
