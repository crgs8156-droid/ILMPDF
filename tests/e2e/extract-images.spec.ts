import { expect, test } from './fixtures';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('extract images: saves each picture once, as JPG or PNG', async ({ page }) => {
  const requests = trackRequests(page);
  await openTool(page, 'extract-images');
  await addPdf(page, 'pictures.pdf', await get('29-images-mixed.pdf'));
  const saved = await collectDownloads(page, () => page.getByTestId('run').click(), 5);
  expect(saved.map((d) => d.suggestedFilename()).sort()).toEqual([
    'pictures-p1-img1.jpg',
    'pictures-p1-img2.png',
    'pictures-p2-img1.jpg',
    'pictures-p3-img1.png',
    'pictures-p3-img2.png',
  ]);
  await expect(page.getByTestId('notice-ok')).toContainText('Saved 5 images: 2 JPG, 3 PNG (skipped 1 tiny image; 1 repeat');
  for (const d of saved) {
    const bytes = await bytesOf(d);
    const jpg = d.suggestedFilename().endsWith('.jpg');
    expect([...bytes.subarray(0, 2)]).toEqual(jpg ? [0xff, 0xd8] : [0x89, 0x50]);
  }
  expect(offOrigin(requests)).toEqual([]);
});

test('extract images: a page range and tiny images', async ({ page }) => {
  await openTool(page, 'extract-images');
  await addPdf(page, 'pictures.pdf', await get('29-images-mixed.pdf'));
  await page.getByTestId('extract-pages').fill('1');
  await page.getByTestId('skip-tiny').uncheck();
  const saved = await collectDownloads(page, () => page.getByTestId('run').click(), 3);
  expect(saved.map((d) => d.suggestedFilename())).toContain('pictures-p1-img3.png');
});

test('extract images: a PDF without pictures says so', async ({ page }) => {
  await openTool(page, 'extract-images');
  await addPdf(page, 'plain.pdf', await get('30-no-images.pdf'));
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('No images found on any page');
});

test('extract images: a bad page range is refused', async ({ page }) => {
  await openTool(page, 'extract-images');
  await addPdf(page, 'pictures.pdf', await get('29-images-mixed.pdf'));
  await page.getByTestId('extract-pages').fill('9');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toBeVisible();
});
