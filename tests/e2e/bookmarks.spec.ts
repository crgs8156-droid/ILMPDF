import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { readBookmarks } from '../../src/engines/mupdf-bookmarks';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('bookmarks: shows, edits and saves bookmarks', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'bookmarks');
  await addPdf(page, 'chapters.pdf', await get('38-bookmarks-chapters.pdf'));
  const rows = page.getByTestId('bm-row');
  await expect(rows).toHaveCount(11);
  await expect(page.getByTestId('bm-title').first()).toHaveValue('Chapter 1: Introduction');
  await expect(page.getByTestId('bm-page').first()).toHaveValue('2');

  // Rename the first bookmark, delete "Appendix", add a new one at the end
  // and nest it under "Chapter 3".
  await page.getByTestId('bm-title').first().fill('Intro');
  await rows.last().getByTestId('bm-delete').click();
  await page.getByTestId('bm-add').click();
  await expect(rows).toHaveCount(11);
  await page.getByTestId('bm-title').last().fill('Extra');
  await page.getByTestId('bm-page').last().fill('12');
  await rows.last().getByTestId('bm-indent').click();

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('chapters-bookmarks.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('11 bookmarks');
  const after = readBookmarks(mupdf, await bytesOf(saved!)).bookmarks;
  expect(after[0]!.title).toBe('Intro');
  expect(after.some((b) => b.title === 'Appendix')).toBe(false);
  expect(after.at(-1)).toMatchObject({ title: 'Extra', page: 11, level: 1 });
  expect(offOrigin(requests)).toEqual([]);
});

test('bookmarks: splits into one PDF per top-level bookmark', async ({ page }) => {
  test.slow();
  await openTool(page, 'bookmarks');
  await addPdf(page, 'chapters.pdf', await get('38-bookmarks-chapters.pdf'));
  await expect(page.getByTestId('bm-split-summary')).toContainText('Makes 5 files');
  const parts = await collectDownloads(page, () => page.getByTestId('bm-split').click(), 5);
  expect(parts.map((d) => d.suggestedFilename())).toEqual([
    'chapters-1-Start.pdf',
    'chapters-2-Chapter 1_ Introduction.pdf',
    'chapters-3-Chapter 2_ Method.pdf',
    'chapters-4-Chapter 3_ Results.pdf',
    'chapters-5-Appendix.pdf',
  ]);
  const counts = await Promise.all(parts.map(async (d) => {
    const doc = mupdf.Document.openDocument(await bytesOf(d), 'application/pdf');
    const n = doc.countPages();
    doc.destroy();
    return n;
  }));
  expect(counts).toEqual([1, 3, 4, 3, 1]);
});

test('bookmarks: hostile titles stay plain text and nothing runs', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openTool(page, 'bookmarks');
  await addPdf(page, 'tricky.pdf', await get('39-bookmarks-tricky.pdf'));
  await expect(page.getByTestId('bm-row')).toHaveCount(11);
  await expect(page.getByTestId('bm-title').nth(4)).toHaveValue('<img src=x onerror=alert(1)> on page 3');
  // Bookmarks with no page in this file show an empty page box.
  await expect(page.getByTestId('bm-page').nth(2)).toHaveValue('');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('bookmarks: a PDF without bookmarks and a locked PDF', async ({ page }) => {
  await openTool(page, 'bookmarks');
  await addPdf(page, 'plain.pdf', makePdf(2));
  await expect(page.getByTestId('bm-empty')).toBeVisible();
  await expect(page.getByTestId('bm-split')).toBeDisabled();
  await page.getByRole('button', { name: 'Choose another file' }).click();
  await addPdf(page, 'locked.pdf', makePdf(1, { encrypted: true }));
  await expect(page.getByTestId('notice-error')).toContainText('password-protected');
});
