import { expect, test } from './fixtures';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { open } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

/** Page count, text and comment count of each page of a saved PDF. */
function inspectSaved(bytes: Uint8Array) {
  const doc = open(mupdf, bytes);
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    pages.push({ text: page.toStructuredText('').asText().includes('Red text you can select'), annots: page.getAnnotations().length });
    page.destroy();
  }
  doc.destroy();
  return pages;
}

test('greyscale / invert: keep-text greyscale keeps text and comments', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'recolor');
  await addPdf(page, 'colour.pdf', await get('41-colour-with-comments.pdf'));
  await expect(page.getByTestId('overlay-note')).toBeVisible();

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('colour-greyscale.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Made a greyscale copy of 1 page');
  expect(inspectSaved(await bytesOf(saved!))).toEqual([{ text: true, annots: 2 }]);
  expect(offOrigin(requests)).toEqual([]);
});

test('greyscale / invert: image-based invert of chosen pages warns and drops their text', async ({ page }) => {
  test.slow();
  await openTool(page, 'recolor');
  await addPdf(page, 'mixed.pdf', await get('40-colourful-mixed.pdf'));
  await page.getByTestId('effect-invert').check();
  await page.getByTestId('mode-raster').check();
  await expect(page.getByTestId('raster-warning')).toContainText('can no longer be selected');
  await page.getByTestId('dpi').selectOption('150');
  await page.getByTestId('recolor-pages').fill('2-3');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('mixed-inverted.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Inverted the colours of 2 pages');
  await expect(page.getByTestId('notice-ok')).toContainText('run OCR');
  expect(inspectSaved(await bytesOf(saved!))).toEqual([
    { text: true, annots: 0 },
    { text: false, annots: 0 },
    { text: false, annots: 0 },
  ]);
});

test('greyscale / invert: a page range outside the file is refused', async ({ page }) => {
  await openTool(page, 'recolor');
  await addPdf(page, 'mixed.pdf', await get('40-colourful-mixed.pdf'));
  await page.getByTestId('recolor-pages').fill('9');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('This PDF has 3 pages');
});
