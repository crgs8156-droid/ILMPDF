import { expect, test } from '@playwright/test';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('compare: lists text changes, shows visual differences and saves a report', async ({ page }) => {
  const requests = trackRequests(page);
  await openTool(page, 'compare');
  await addPdf(page, 'version-1.pdf', await get('23-compare-original.pdf'));
  await expect(page.getByTestId('slot-older').getByTestId('loaded-file')).toContainText('version-1.pdf');
  await addPdf(page, 'version-2.pdf', await get('24-compare-changed.pdf'));
  await expect(page.getByTestId('slot-newer').getByTestId('loaded-file')).toContainText('version-2.pdf');

  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('words removed');
  const changes = page.getByTestId('text-changes');
  await expect(changes.getByTestId('word-removed').first()).toHaveText('1200');
  await expect(changes.getByTestId('word-added').first()).toHaveText('1500');
  await expect(changes).toContainText('A late fee');

  const [report] = await collectDownloads(page, () => page.getByTestId('save-report').click(), 1);
  expect(report!.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-compare-report\.txt$/);
  const text = new TextDecoder().decode(await bytesOf(report!));
  expect(text).toContain('Older file: version-1.pdf');
  expect(text).toContain('- removed: 1200');

  // Visual: page 1 is identical, page 3's square moved, page 4 is new.
  await page.getByTestId('tab-visual').click();
  const status = page.getByTestId('visual-status');
  await expect(page.getByTestId('page-label')).toHaveText('Page 1 of 4');
  await expect(status).toHaveText('No visual differences on this page.');
  await page.getByTestId('next-page').click();
  await page.getByTestId('next-page').click();
  await expect(status).toContainText('looks different');
  await page.getByTestId('visual-mode').selectOption('side');
  await page.getByTestId('next-page').click();
  await expect(status).toHaveText('Only the newer file has a page 4.');
  expect(offOrigin(requests)).toEqual([]);
});

test('compare: the same file twice has no changes', async ({ page }) => {
  await openTool(page, 'compare');
  await addPdf(page, 'a.pdf', await get('02-five-pages.pdf'));
  await expect(page.getByTestId('slot-older').getByTestId('loaded-file')).toBeVisible();
  await addPdf(page, 'b.pdf', await get('02-five-pages.pdf'));
  await page.getByTestId('run').click();
  await expect(page.getByTestId('no-changes')).toBeVisible();
  await expect(page.getByTestId('notice-ok')).toContainText('same in both files');
});

test('compare: a password-protected file gets a clear message', async ({ page }) => {
  await openTool(page, 'compare');
  await addPdf(page, 'a.pdf', await get('02-five-pages.pdf'));
  await expect(page.getByTestId('slot-older').getByTestId('loaded-file')).toBeVisible();
  await addPdf(page, 'locked.pdf', await get('14-password-aes256-is-test.pdf'));
  // The page counter refuses locked files, so it never reaches the comparison.
  await expect(page.getByTestId('notice-error')).toContainText('locked.pdf');
  await expect(page.getByTestId('slot-newer').getByTestId('loaded-file')).toHaveCount(0);
  await expect(page.getByTestId('run')).toHaveCount(0);
});
