import { expect, test } from './fixtures';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { extractText } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('ocr: makes scanned pages searchable, skips the typed page, and stays offline', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'ocr');
  await addPdf(page, 'scan.pdf', await get('22-scanned-text.pdf'));
  await expect(page.getByTestId('ocr-skip-text')).toBeChecked();

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('scan-ocr.pdf');
  const text = extractText(mupdf, await bytesOf(saved!)).pages;
  expect(text[0]).toContain('Invoice');
  expect(text[0]).toContain('4821');
  expect(text[1]!.match(/real text/g)).toHaveLength(1);
  expect(text[2]).toContain('Parcel');
  await expect(page.getByTestId('notice-ok')).toContainText('Made 2 pages searchable');
  await expect(page.getByTestId('notice-ok')).toContainText('Left 1 page that already had text');
  await expect(page.getByTestId('ocr-progress')).toHaveCount(0);
  expect(offOrigin(requests)).toEqual([]);
});

test('ocr: a file whose pages all have text needs nothing, and saves nothing', async ({ page }) => {
  await openTool(page, 'ocr');
  await addPdf(page, 'typed.pdf', await get('02-five-pages.pdf'));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('Every page already has text');
  expect(downloads).toBe(0);
});

test('ocr: a wrong page range is explained', async ({ page }) => {
  await openTool(page, 'ocr');
  await addPdf(page, 'scan.pdf', await get('22-scanned-text.pdf'));
  await page.getByTestId('ocr-pages').fill('9');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('This PDF has 3 pages');
});

test('ocr: cancel stops the job and saves nothing', async ({ page }) => {
  await openTool(page, 'ocr');
  await addPdf(page, 'scan.pdf', await get('22-scanned-text.pdf'));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('run').click();
  await page.getByTestId('ocr-cancel').click();
  await expect(page.getByTestId('notice-error')).toContainText('OCR was cancelled');
  await expect(page.getByTestId('run')).toBeEnabled();
  expect(downloads).toBe(0);
});
