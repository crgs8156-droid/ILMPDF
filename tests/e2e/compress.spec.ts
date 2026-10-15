import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { inspect } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('compress: strong level makes a scanned file much smaller', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  const scanned = await get('17-scanned-heavy.pdf');
  await openTool(page, 'compress');
  await addPdf(page, 'scan.pdf', scanned);
  await expect(page.getByTestId('level-recommended')).toBeChecked();
  await page.getByTestId('level-strong').check();

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('scan-compressed.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('% smaller');
  const out = await bytesOf(saved!);
  expect(out.length).toBeLessThan(scanned.length * 0.15);
  expect(inspect(mupdf, out).pages).toBe(3);
  expect(offOrigin(requests)).toEqual([]);
});

test('compress: a file that cannot get smaller is not saved', async ({ page }) => {
  await openTool(page, 'compress');
  await addPdf(page, 'tiny.pdf', makePdf(1));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('already compact');
  expect(downloads).toBe(0);
});
