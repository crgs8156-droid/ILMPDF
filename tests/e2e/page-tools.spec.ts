import { expect, test } from './fixtures';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { pageToolsTestFiles } from '../../scripts/page-tools-test-pdfs.mjs';

/** Pages with text, except the (1-based) page numbers listed in `blank`. */
async function withBlanks(count: number, blank: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= count; n++) {
    const page = doc.addPage([300 + n, 400]);
    if (!blank.includes(n)) page.drawText(`Page ${n} has text`, { x: 30, y: 200, size: 24, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

test('page tools: resize every page to A4', async ({ page }) => {
  const requests = trackRequests(page);
  await openTool(page, 'page-tools');
  await addPdf(page, 'doc.pdf', makePdf(2));
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('doc-resized.pdf');
  const pages = (await PDFDocument.load(await bytesOf(saved!))).getPages();
  expect(pages.map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[595, 842], [595, 842]]);
  await expect(page.getByTestId('notice-ok')).toContainText('Resized 2 pages');
  expect(offOrigin(requests)).toEqual([]);
});

test('page tools: resize to a custom size, landscape, chosen pages only', async ({ page }) => {
  await openTool(page, 'page-tools');
  await addPdf(page, 'doc.pdf', makePdf(3));
  await page.getByTestId('resize-paper').selectOption('custom');
  await page.getByTestId('resize-width').fill('100');
  await page.getByTestId('resize-height').fill('50');
  await page.getByTestId('resize-orientation').selectOption('landscape');
  await page.getByTestId('resize-pages').fill('2');
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  // 100 mm = 283.46 points.
  expect(await widths(await bytesOf(saved!))).toEqual([200, 283, 202]);
});

test('page tools: insert blank pages after a page', async ({ page }) => {
  await openTool(page, 'page-tools');
  await addPdf(page, 'doc.pdf', makePdf(3));
  await page.getByTestId('page-tools-mode').selectOption('insert');
  await page.getByTestId('insert-count').fill('2');
  await page.getByTestId('insert-where').selectOption('after');
  await page.getByTestId('insert-page').fill('1');
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('doc-inserted.pdf');
  expect(await widths(await bytesOf(saved!))).toEqual([200, 200, 200, 201, 202]);
});

test('page tools: insert pages from another PDF at the start', async ({ page }) => {
  await openTool(page, 'page-tools');
  await addPdf(page, 'doc.pdf', makePdf(2));
  await page.getByTestId('page-tools-mode').selectOption('insert');
  await page.getByTestId('insert-what').selectOption('pdf');
  await page.getByTestId('insert-where').selectOption('start');
  await addPdf(page, 'extra.pdf', await withBlanks(2, []));
  await expect(page.getByText('extra.pdf')).toBeVisible();
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(await widths(await bytesOf(saved!))).toEqual([301, 302, 200, 201]);
  await expect(page.getByTestId('notice-ok')).toContainText('Added 2 pages');
});

test('page tools: find and remove blank pages, keeping one the user unticks', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'page-tools');
  await addPdf(page, 'scan.pdf', await withBlanks(6, [2, 4, 5]));
  await page.getByTestId('page-tools-mode').selectOption('blank');
  await page.getByTestId('find-blank').click();
  const cards = page.getByTestId('blank-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('data-index', '1');
  // Keep page 5 after all.
  await cards.nth(2).getByTestId('blank-remove').uncheck();
  await expect(page.getByTestId('run')).toHaveText('Remove 2 pages');
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('scan-no-blanks.pdf');
  expect(await widths(await bytesOf(saved!))).toEqual([301, 303, 305, 306]);
  expect(offOrigin(requests)).toEqual([]);
});

test('page tools: says so when no page is blank', async ({ page }) => {
  await openTool(page, 'page-tools');
  await addPdf(page, 'full.pdf', await withBlanks(2, []));
  await page.getByTestId('page-tools-mode').selectOption('blank');
  await page.getByTestId('find-blank').click();
  await expect(page.getByTestId('notice-info')).toContainText('No blank pages found');
  await expect(page.getByTestId('blank-card')).toHaveCount(0);
});

test('page tools: each sensitivity finds the pages test file 35 promises', async ({ page }) => {
  test.slow();
  const files: { name: string; bytes: Uint8Array }[] = await pageToolsTestFiles();
  await openTool(page, 'page-tools');
  await addPdf(page, '35-blank-pages.pdf', files.find((f) => f.name === '35-blank-pages.pdf')!.bytes);
  await page.getByTestId('page-tools-mode').selectOption('blank');
  const expected = { strict: ['1', '6'], normal: ['1', '3', '6'], scans: ['1', '3', '4', '6'] };
  for (const [level, indices] of Object.entries(expected)) {
    await page.getByTestId('blank-sensitivity').selectOption(level);
    await page.getByTestId('find-blank').click();
    await expect(page.getByTestId('blank-card')).toHaveCount(indices.length);
    const found = await page.getByTestId('blank-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-index')));
    expect(found, level).toEqual(indices);
  }
});
