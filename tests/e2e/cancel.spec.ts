import { expect, test } from './fixtures';
import { addPdf, collectDownloads, openTool } from './helpers';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('cancel: stops Compress, saves nothing, and the tool works again after', async ({ page }) => {
  test.slow();
  await openTool(page, 'compress');
  await addPdf(page, 'scan.pdf', await get('17-scanned-heavy.pdf'));
  await page.getByTestId('level-strong').check();
  let downloads = 0;
  page.on('download', () => downloads++);

  await page.getByTestId('run').click();
  await expect(page.getByTestId('elapsed')).toHaveText(/^\d+:\d\d$/);
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('notice-info')).toContainText('Cancelled. Nothing was saved.');
  await expect(page.getByTestId('notice-error')).toHaveCount(0);
  await expect(page.getByTestId('cancel')).toHaveCount(0);
  await expect(page.getByTestId('run')).toBeEnabled();
  // Give a stray result time to arrive, if the worker had not really ended.
  await page.waitForTimeout(1500);
  expect(downloads).toBe(0);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('scan-compressed.pdf');
  await expect(page.getByTestId('notice-info')).toHaveCount(0);
});

test('cancel: stops a batch and makes no ZIP', async ({ page }) => {
  test.slow();
  await openTool(page, 'batch');
  const heavy = await get('17-scanned-heavy.pdf');
  await page.getByTestId('file-input').first().setInputFiles(
    ['a', 'b', 'c'].map((n) => ({ name: `${n}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(heavy) })),
  );
  await expect(page.getByTestId('batch-file')).toHaveCount(3);
  let downloads = 0;
  page.on('download', () => downloads++);

  await page.getByTestId('run').click();
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('notice-info')).toContainText('Cancelled. Nothing was saved.');
  await expect(page.getByTestId('batch-failed')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(downloads).toBe(0);
});
