import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { readZip } from '../fixtures/read-zip';
import { inspect } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

async function addPdfs(page: Page, names: string[]): Promise<void> {
  const payload = await Promise.all(
    names.map(async (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(await get(name)) })),
  );
  await page.getByTestId('file-input').first().setInputFiles(payload);
  await expect(page.getByTestId('batch-file')).toHaveCount(names.length);
}

async function runToZip(page: Page) {
  const [zip] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  return { name: zip!.suggestedFilename(), files: readZip(await bytesOf(zip!)) };
}

test('batch: compress three files, one broken, into one ZIP with a report', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'batch');
  await addPdfs(page, ['17-scanned-heavy.pdf', '26-batch-broken-inside.pdf', '25-batch-letter.pdf']);
  await page.getByTestId('batch-level').selectOption('strong');

  const zip = await runToZip(page);
  expect(zip.name).toBe('ilmpdf-batch-compressed.zip');
  expect(zip.files.map((f) => f.name)).toEqual([
    '17-scanned-heavy-compressed.pdf',
    '25-batch-letter-compressed.pdf',
    'ilmpdf-batch-report.txt',
  ]);
  expect(inspect(mupdf, zip.files[0]!.data).pages).toBe(3);
  expect(zip.files[0]!.data.length).toBeLessThan((await get('17-scanned-heavy.pdf')).length * 0.15);
  expect(inspect(mupdf, zip.files[1]!.data).pages).toBe(2);
  const report = new TextDecoder().decode(zip.files[2]!.data);
  expect(report).toContain('Done: 2 of 3 files');
  expect(report).toContain('FAILED  26-batch-broken-inside.pdf');

  await expect(page.getByTestId('batch-ok')).toHaveCount(2);
  await expect(page.getByTestId('batch-failed')).toHaveCount(1);
  await expect(page.getByTestId('notice-ok')).toContainText('Saved 2 files');
  await expect(page.getByTestId('notice-ok')).toContainText('1 failed');
  expect(offOrigin(requests)).toEqual([]);
});

test('batch: unlock with one shared password; a file without one is listed as failed', async ({ page }) => {
  test.slow();
  await openTool(page, 'batch');
  await addPdfs(page, ['10-password-is-test.pdf', '14-password-aes256-is-test.pdf', '01-one-page.pdf']);
  await page.getByTestId('batch-action').selectOption('unlock');
  await expect(page.getByTestId('run')).toBeDisabled();
  await page.getByTestId('password').fill('test');

  const zip = await runToZip(page);
  expect(zip.name).toBe('ilmpdf-batch-unlocked.zip');
  const pdfs = zip.files.filter((f) => f.name.endsWith('.pdf'));
  expect(pdfs.map((f) => f.name)).toEqual(['10-password-is-test-unlocked.pdf', '14-password-aes256-is-test-unlocked.pdf']);
  for (const f of pdfs) expect(inspect(mupdf, f.data).encrypted).toBe(false);
  await expect(page.getByTestId('batch-failed')).toContainText("isn't password-protected");
  // The password is cleared as soon as the batch starts.
  await expect(page.getByTestId('password')).toHaveValue('');
});

test('batch: protect gives every file the same password', async ({ page }) => {
  test.slow();
  await openTool(page, 'batch');
  await addPdfs(page, ['01-one-page.pdf', '02-five-pages.pdf']);
  await page.getByTestId('batch-action').selectOption('protect');
  await page.getByTestId('password').fill('batch-pass-123');
  await page.getByTestId('confirm').fill('batch-pass-12');
  await expect(page.getByTestId('mismatch')).toBeVisible();
  await expect(page.getByTestId('run')).toBeDisabled();
  await page.getByTestId('confirm').fill('batch-pass-123');

  const zip = await runToZip(page);
  const pdfs = zip.files.filter((f) => f.name.endsWith('.pdf'));
  expect(pdfs).toHaveLength(2);
  for (const f of pdfs) {
    expect(inspect(mupdf, f.data)).toMatchObject({ encrypted: true, needsPassword: true });
    const doc = mupdf.PDFDocument.openDocument(f.data, 'application/pdf') as mupdf.PDFDocument;
    expect(doc.authenticatePassword('batch-pass-123')).toBeGreaterThan(0);
    doc.destroy();
  }
});

test('batch: when every file fails, nothing is saved', async ({ page }) => {
  await openTool(page, 'batch');
  await addPdfs(page, ['26-batch-broken-inside.pdf']);
  await page.getByTestId('batch-action').selectOption('stripMetadata');
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('nothing was saved');
  expect(downloads).toBe(0);
});
