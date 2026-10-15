import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();

function watchCsp(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // The app's own offline self-check is meant to be refused, so it doesn't count.
    const probe = m.text().includes('__ilmpdf_network_probe');
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && !probe) errors.push(m.text());
  });
  return errors;
}

/** How much of a region (fractions of the shown page) is not white. */
function ink(bytes: Uint8Array, page: number, box: [number, number, number, number]): number {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const shot = doc.loadPage(page).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const [w, h, px] = [shot.getWidth(), shot.getHeight(), shot.getPixels()];
  let dark = 0;
  let total = 0;
  for (let y = Math.floor(box[1] * h); y < box[3] * h; y++) {
    for (let x = Math.floor(box[0] * w); x < box[2] * w; x++) {
      total++;
      if (px[(y * w + x) * 3]! < 128) dark++;
    }
  }
  doc.destroy();
  return dark / total;
}

async function drawSignature(page: Page) {
  const pad = page.getByTestId('signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 120);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 30 + i * 12, box.y + 120 - Math.sin(i / 2) * 40);
  await page.mouse.up();
  await page.getByTestId('use-drawing').click();
  await expect(page.getByTestId('signature-ready')).toBeVisible();
}

test('sign: a drawn signature lands where it was placed', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  const csp = watchCsp(page);
  await openTool(page, 'sign');
  await addPdf(page, 'contract.pdf', makePdf(2));
  await drawSignature(page);

  // Place it near the bottom-right of page 2.
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-label')).toHaveText('Page 2 of 2');
  const preview = (await page.getByTestId('page-preview').boundingBox())!;
  await page.mouse.click(preview.x + preview.width * 0.75, preview.y + preview.height * 0.85);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('contract-signed.pdf');
  const out = await bytesOf(saved!);
  expect(ink(out, 1, [0.55, 0.78, 0.95, 0.92])).toBeGreaterThan(0.005);
  expect(ink(out, 1, [0.05, 0.05, 0.45, 0.4])).toBe(0);
  expect(ink(out, 0, [0.55, 0.78, 0.95, 0.92])).toBe(0);
  expect(offOrigin(requests)).toEqual([]);
  expect(csp).toEqual([]);
});

test('sign: an image signature can go on every page', async ({ page }) => {
  test.slow();
  const png = (await files).find((f) => f.name === 'image-02-portrait.png')!.bytes;
  await openTool(page, 'sign');
  await addPdf(page, 'report.pdf', makePdf(3));
  await page.getByTestId('tab-image').click();
  await page.getByTestId('file-input').setInputFiles({ name: 'sig.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByTestId('signature-ready')).toBeVisible();
  await page.getByTestId('every-page').check();
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  await expect(page.getByTestId('notice-ok')).toContainText('3 pages');
  const out = await bytesOf(saved!);
  const doc = mupdf.Document.openDocument(out, 'application/pdf');
  expect(doc.countPages()).toBe(3);
  doc.destroy();
});
