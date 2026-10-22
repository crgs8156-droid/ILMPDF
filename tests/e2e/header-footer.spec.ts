import { expect, test } from './fixtures';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

function pageTexts(bytes: Uint8Array): string[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText('').asText().replace(/\s+/g, ' ').trim());
}

test('headers & footers: Bates numbers skip the cover page', async ({ page }) => {
  const requests = trackRequests(page);
  await openTool(page, 'header-footer');
  await addPdf(page, 'contract.pdf', makePdf(4));

  // Start from empty boxes so only what this test types is stamped.
  for (const slot of ['top-left', 'top-right', 'bottom-center']) await page.getByTestId(`hf-${slot}`).fill('');
  await page.getByTestId('hf-top-center').fill('{file}');
  await page.getByTestId('hf-bottom-right').fill('{bates}');
  await page.getByTestId('hf-prefix').fill('ABC');
  await page.getByTestId('hf-start').fill('41');
  await page.getByTestId('hf-pages').fill('2-');
  // The preview shows the first stamped page before anything runs.
  await expect(page.getByTestId('hf-preview-bottom-right')).toHaveText('ABC000041');
  await expect(page.getByTestId('hf-preview-top-center')).toHaveText('contract');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('contract-stamped.pdf');
  const texts = pageTexts(await bytesOf(saved!));
  expect(texts[0]).toBe('');
  expect(texts.slice(1)).toEqual(['contract ABC000041', 'contract ABC000042', 'contract ABC000043']);
  expect(offOrigin(requests)).toEqual([]);
});

test('headers & footers: explains text the font cannot show', async ({ page }) => {
  await openTool(page, 'header-footer');
  await addPdf(page, 'notes.pdf', makePdf(1));
  await page.getByTestId('hf-top-left').fill('秘密');
  await page.getByTestId('run').click();
  await expect(page.getByText(/basic Latin/)).toBeVisible();
});
