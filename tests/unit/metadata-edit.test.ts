import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { cleanValue, editMetadata } from '../../src/engines/metadata-edit';
import { readMetadata } from '../../src/engines/pdflib-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

type TestFile = { name: string; bytes: Uint8Array };
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

describe('editMetadata', async () => {
  const files: TestFile[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes.slice();

  it('adds details to a file that has none', async () => {
    const out = await editMetadata(makePdf(2), { values: { Title: 'New title', Author: 'Me', Keywords: 'a b c' }, touchModified: false });
    expect(await readMetadata(out)).toMatchObject({ Title: 'New title', Author: 'Me', Keywords: 'a b c' });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('changes some fields, removes empty ones and leaves the rest alone', async () => {
    const out = await editMetadata(get('08-with-metadata.pdf'), { values: { Title: 'Renamed', Author: '' }, touchModified: false });
    const meta = await readMetadata(out);
    expect(meta.Title).toBe('Renamed');
    expect(meta.Author).toBeUndefined();
    expect(meta.Subject).toBe('A made-up document for metadata tests');
    expect(latin1(out)).not.toContain('Jane Example');
  });

  it('keeps accented and non-Latin text intact', async () => {
    const before = await readMetadata(get('36-metadata-unicode.pdf'));
    expect(before.Title).toBe('Café menu: 東京 / Ελληνικά');
    const out = await editMetadata(get('36-metadata-unicode.pdf'), { values: { Author: 'Ŝarlo 李' }, touchModified: false });
    expect(await readMetadata(out)).toMatchObject({ Title: before.Title, Author: 'Ŝarlo 李' });
  });

  it('removes the stale XMP copy', async () => {
    const src = get('37-metadata-with-xmp.pdf');
    expect(latin1(src)).toContain('Stale XMP Author');
    expect((await readMetadata(src))['XMP metadata']).toBe('present');
    const out = await editMetadata(src, { values: { Title: 'Fresh' }, touchModified: false });
    expect(latin1(out)).not.toContain('Stale XMP');
    expect((await readMetadata(out))['XMP metadata']).toBeUndefined();
  });

  it('sets the modified date only when asked', async () => {
    const src = get('08-with-metadata.pdf');
    const kept = await readMetadata(await editMetadata(src.slice(), { values: {}, touchModified: false }));
    expect(kept.Modified).toBe('2026-01-01T12:00:00.000Z');
    const t0 = Date.now();
    const touched = await readMetadata(await editMetadata(src, { values: {}, touchModified: true }));
    expect(new Date(touched.Modified!).getTime()).toBeGreaterThanOrEqual(t0 - 2000);
  });

  it('cleans control characters and rejects over-long values', async () => {
    expect(cleanValue('  a\nb\t\u0000c d  ')).toBe('a b c d');
    expect(cleanValue(42)).toBe('');
    const out = await editMetadata(makePdf(1), { values: { Title: 'line1\r\nline2' }, touchModified: false });
    expect((await readMetadata(out)).Title).toBe('line1 line2');
    await expect(editMetadata(makePdf(1), { values: { Title: 'x'.repeat(1001) }, touchModified: false })).rejects.toThrow(/too long/);
  });

  it('refuses encrypted files with the usual message', async () => {
    await expect(editMetadata(makePdf(1, { encrypted: true }), { values: { Title: 'x' }, touchModified: false })).rejects.toThrow(
      /password-protected/,
    );
  });
});

describe('stripMetadata', async () => {
  const { stripMetadata } = await import('../../src/engines/pdflib-ops');
  const files: TestFile[] = await buildTestFiles();

  it('deletes the XMP stream itself, not only the link to it', async () => {
    const src = files.find((f) => f.name === '37-metadata-with-xmp.pdf')!.bytes.slice();
    const out = await stripMetadata(src);
    expect(latin1(out)).not.toContain('Stale XMP');
    expect(latin1(out)).not.toContain('Info Author');
  });
});
