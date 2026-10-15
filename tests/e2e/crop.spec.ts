import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

function watchCsp(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // The app's own offline self-check is meant to be refused, so it doesn't count.
    const probe = m.text().includes('__ilmpdf_network_probe');
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && !probe) errors.push(m.text());
  });
  return errors;
}

async function dragFrame(page: Page, from: [number, number], to: [number, number]) {
  const preview = page.getByTestId('page-preview');
  await expect(preview.locator('canvas')).toBeVisible();
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2));
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1]);
  await page.mouse.up();
}

test('crop: drawing a frame crops every page to it', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  const csp = watchCsp(page);
  await openTool(page, 'crop');
  await addPdf(page, 'scan.pdf', makePdf(3));
  await dragFrame(page, [0.25, 0.25], [0.75, 0.75]);
  await expect(page.getByTestId('crop-size')).toContainText('Keeping 50% of the width and 50% of the height');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('scan-cropped.pdf');
  const pages = (await PDFDocument.load(await bytesOf(saved!))).getPages();
  // makePdf's page i is (200 + i) x 300 points; allow a little for mouse rounding.
  pages.forEach((p, i) => {
    expect(p.getCropBox().width).toBeCloseTo((200 + i) / 2, -1);
    expect(p.getCropBox().height).toBeCloseTo(150, -1);
  });
  expect(offOrigin(requests)).toEqual([]);
  expect(csp).toEqual([]);
});

test('crop: "only this page" leaves the other pages alone', async ({ page }) => {
  await openTool(page, 'crop');
  await addPdf(page, 'doc.pdf', makePdf(2));
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-label')).toHaveText('Page 2 of 2');
  await dragFrame(page, [0.02, 0.02], [0.52, 0.98]);
  await expect(page.getByTestId('crop-size')).toContainText('Keeping 50% of the width and 96% of the height');
  await page.getByTestId('scope-page').check();
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const pages = (await PDFDocument.load(await bytesOf(saved!))).getPages();
  expect(pages[0]!.getCropBox().width).toBe(200);
  expect(pages[1]!.getCropBox().width).toBeCloseTo(100.5, -1);
});
