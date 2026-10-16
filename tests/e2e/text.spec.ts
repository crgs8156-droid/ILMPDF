import { expect, test } from '@playwright/test';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('pdf to text: saves every page as a .txt file and shows a preview', async ({ page }) => {
  const requests = trackRequests(page);
  await openTool(page, 'pdf-to-text');
  await addPdf(page, 'report.pdf', await get('02-five-pages.pdf'));

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('report.txt');
  const text = new TextDecoder().decode(await bytesOf(saved!));
  for (let n = 1; n <= 5; n++) {
    expect(text).toContain(`--- Page ${n} ---`);
    expect(text).toContain(`Page ${n} of 5`);
  }
  expect(text.indexOf('--- Page 2 ---')).toBeLessThan(text.indexOf('--- Page 3 ---'));
  await expect(page.getByTestId('notice-ok')).toContainText('5 pages');
  await expect(page.getByTestId('text-preview')).toHaveValue(/Page 4 of 5/);

  // Without page markers, the preview updates straight away.
  await page.getByTestId('mark-pages').uncheck();
  await expect(page.getByTestId('text-preview')).not.toHaveValue(/--- Page/);
  expect(offOrigin(requests)).toEqual([]);
});

test('pdf to text: a scanned file explains why there is no text, and saves nothing', async ({ page }) => {
  await openTool(page, 'pdf-to-text');
  await addPdf(page, 'scan.pdf', await get('17-scanned-heavy.pdf'));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('No text was found');
  await expect(page.getByTestId('text-preview')).toHaveCount(0);
  expect(downloads).toBe(0);
});

test('pdf to text: an empty PDF also saves nothing', async ({ page }) => {
  await openTool(page, 'pdf-to-text');
  await addPdf(page, 'blank.pdf', makePdf(2));
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('No text was found');
});
