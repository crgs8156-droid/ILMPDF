import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { open } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('repair: a broken file is rebuilt and saved', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'repair');
  await addPdf(page, 'broken.pdf', await get('16-repairable.pdf'));
  await expect(page.getByTestId('loaded-file')).toContainText('broken.pdf');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('broken-repaired.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Repaired and saved a fixed copy with 3 pages');
  const doc = open(mupdf, await bytesOf(saved!));
  expect(doc.countPages()).toBe(3);
  expect(doc.wasRepaired()).toBe(false);
  doc.destroy();
  expect(offOrigin(requests)).toEqual([]);
});

test('repair: an undamaged file says no damage was found', async ({ page }) => {
  await openTool(page, 'repair');
  await addPdf(page, 'fine.pdf', makePdf(2));
  await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  await expect(page.getByTestId('notice-ok')).toContainText('No damage found');
});

test('repair: a hopeless file gets a clear message, not a crash', async ({ page }) => {
  await openTool(page, 'repair');
  await addPdf(page, 'cut.pdf', await get('11-damaged.pdf'));
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('too damaged to repair');
  await expect(page.getByTestId('run')).toBeEnabled();
});
