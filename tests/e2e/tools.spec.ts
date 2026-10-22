import { expect, test } from './fixtures';
import { PDFDocument, PDFName } from 'pdf-lib';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf, TINY_PNG } from '../fixtures/make-pdf';

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

test.beforeEach(async ({ page }) => {
  const requests = trackRequests(page);
  (page as unknown as { __requests: typeof requests }).__requests = requests;
});

test.afterEach(async ({ page }) => {
  const requests = (page as unknown as { __requests: Parameters<typeof offOrigin>[0] }).__requests;
  expect(offOrigin(requests), 'no request may leave the local server').toEqual([]);
});

test('home page lists every tool', async ({ page }) => {
  await page.goto('/');
  for (const id of ['merge', 'split', 'organize', 'images-to-pdf', 'pdf-to-images', 'page-numbers', 'watermark', 'metadata', 'unlock', 'protect', 'repair', 'compress', 'forms', 'sign', 'crop', 'pdf-to-text', 'header-footer']) {
    await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  }
});

test('merge joins PDFs in the chosen order', async ({ page }) => {
  await openTool(page, 'merge');
  await addPdf(page, 'a.pdf', makePdf(2));
  await addPdf(page, 'b.pdf', makePdf(3));
  await expect(page.getByTestId('merge-row')).toHaveCount(2);
  await expect(page.getByTestId('merge-row').first()).toContainText('a.pdf');
  await page.getByTestId('merge-row').nth(1).getByLabel('Move up').click();
  const [d] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(d!.suggestedFilename()).toBe('merged.pdf');
  expect(await widths(await bytesOf(d!))).toEqual([200, 201, 202, 200, 201]);
});

test('split by ranges makes one file per range', async ({ page }) => {
  await openTool(page, 'split');
  await addPdf(page, 'report.pdf', makePdf(5));
  await page.getByTestId('split-spec').fill('1-2, 5');
  const files = await collectDownloads(page, () => page.getByTestId('run').click(), 2);
  const names = files.map((f) => f.suggestedFilename()).sort();
  expect(names).toEqual(['report-part-1.pdf', 'report-part-2.pdf']);
  const byName = Object.fromEntries(await Promise.all(files.map(async (f) => [f.suggestedFilename(), await bytesOf(f)])));
  expect(await widths(byName['report-part-1.pdf'])).toEqual([200, 201]);
  expect(await widths(byName['report-part-2.pdf'])).toEqual([204]);
});

test('split rejects a bad range without running', async ({ page }) => {
  await openTool(page, 'split');
  await addPdf(page, 'report.pdf', makePdf(3));
  await page.getByTestId('split-spec').fill('2-9');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('3 pages');
});

test('organize renders thumbnails, then reorders, rotates, deletes and extracts', async ({ page }) => {
  await openTool(page, 'organize');
  await addPdf(page, 'deck.pdf', makePdf(4));
  const cards = page.getByTestId('page-card');
  await expect(cards).toHaveCount(4);
  // Thumbnails are drawn by PDF.js into canvases with real pixels.
  await expect
    .poll(() => cards.first().locator('canvas').evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(1);

  await cards.nth(3).getByTestId('left').click(); // order: 0,1,3,2
  await cards.nth(0).getByTestId('rotate').click(); // page 1 → 90°
  await cards.nth(1).getByTestId('delete').click(); // drop page 2 → 0,3,2
  await expect(cards).toHaveCount(3);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const doc = await PDFDocument.load(await bytesOf(saved!));
  expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([200, 203, 202]);
  expect(doc.getPage(0).getRotation().angle).toBe(90);

  await cards.nth(1).getByTestId('select').check();
  const [extracted] = await collectDownloads(page, () => page.getByTestId('extract').click(), 1);
  expect(extracted!.suggestedFilename()).toBe('deck-extract.pdf');
  expect(await widths(await bytesOf(extracted!))).toEqual([203]);
});

test('images to PDF makes one page per image', async ({ page }) => {
  await openTool(page, 'images-to-pdf');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG) },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG) },
  ]);
  const [d] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const doc = await PDFDocument.load(await bytesOf(d!));
  expect(doc.getPageCount()).toBe(2);
});

test('PDF to images renders real PNG files', async ({ page }) => {
  await openTool(page, 'pdf-to-images');
  await addPdf(page, 'scan.pdf', makePdf(3));
  await page.getByTestId('img-pages').fill('1, 3');
  const files = await collectDownloads(page, () => page.getByTestId('run').click(), 2);
  expect(files.map((f) => f.suggestedFilename()).sort()).toEqual(['scan-page-1.png', 'scan-page-3.png']);
  const png = await bytesOf(files[0]!);
  expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test('page numbers and watermark keep every page', async ({ page }) => {
  await openTool(page, 'page-numbers');
  await addPdf(page, 'notes.pdf', makePdf(3));
  const [numbered] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(numbered!.suggestedFilename()).toBe('notes-numbered.pdf');
  expect(await widths(await bytesOf(numbered!))).toEqual([200, 201, 202]);

  await openTool(page, 'watermark');
  await addPdf(page, 'notes.pdf', makePdf(2));
  await page.getByTestId('wm-text').fill('DRAFT');
  const [marked] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(await widths(await bytesOf(marked!))).toEqual([200, 201]);
});

test('remove metadata shows and strips author and title', async ({ page }) => {
  const src = await PDFDocument.create();
  src.addPage();
  src.setTitle('Salary review');
  src.setAuthor('Jane Example');
  const bytes = await src.save();

  await openTool(page, 'metadata');
  await addPdf(page, 'review.pdf', bytes);
  await expect(page.getByTestId('meta-Author')).toHaveValue('Jane Example');
  const [clean] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const out = await PDFDocument.load(await bytesOf(clean!), { updateMetadata: false });
  expect(out.getAuthor()).toBeUndefined();
  expect(out.getTitle()).toBeUndefined();
});

test('edit metadata changes the title, clears the author and drops the old XMP copy', async ({ page }) => {
  const src = await PDFDocument.create({ updateMetadata: false });
  src.addPage();
  src.setTitle('Old title');
  src.setAuthor('Jane Example');
  const xmp = src.context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/">Old XMP author</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  src.catalog.set(PDFName.of('Metadata'), src.context.register(xmp));
  const bytes = await src.save({ useObjectStreams: false });

  await openTool(page, 'metadata');
  await addPdf(page, 'report.pdf', bytes);
  await expect(page.getByTestId('meta-Title')).toHaveValue('Old title');
  await page.getByTestId('meta-Title').fill('Café report 東京');
  await page.getByTestId('meta-Author').fill('');
  await page.getByTestId('meta-Keywords').fill('<img src=x onerror=alert(1)>');
  const [edited] = await collectDownloads(page, () => page.getByTestId('meta-save').click(), 1);
  expect(edited!.suggestedFilename()).toBe('report-edited.pdf');
  const outBytes = await bytesOf(edited!);
  const out = await PDFDocument.load(outBytes, { updateMetadata: false });
  expect(out.getTitle()).toBe('Café report 東京');
  expect(out.getAuthor()).toBeUndefined();
  expect(out.getKeywords()).toBe('<img src=x onerror=alert(1)>');
  expect(new TextDecoder('latin1').decode(outBytes)).not.toContain('Old XMP author');
});
