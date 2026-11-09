import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { bytesOf, offOrigin, trackRequests } from './helpers';
import { TINY_PNG, makePdf, makeScriptedPdf } from '../fixtures/make-pdf';
import { RINGS, sliceCentre } from '../../src/core/wheel';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

type Drop = { name: string; bytes: Uint8Array; type?: string };

/**
 * Playwright cannot drag files in from the desktop, so this replays the
 * events the browser sends: dragenter at the first point, dragover at each
 * point, then drop (or dragleave) at the last one. The files ride along in a
 * real DataTransfer, as they would from Finder.
 */
async function drag(page: Page, items: Drop[], points: [number, number][], end: 'drop' | 'leave' | 'none' = 'drop') {
  const payload = items.map((f) => ({ name: f.name, type: f.type ?? 'application/pdf', data: Array.from(f.bytes) }));
  await page.evaluate(
    ({ payload, points, end }) => {
      const dt = new DataTransfer();
      for (const f of payload) dt.items.add(new File([new Uint8Array(f.data)], f.name, { type: f.type }));
      const fire = (type: string, [x, y]: [number, number]) =>
        document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      fire('dragenter', points[0]!);
      for (const p of points) fire('dragover', p);
      const last = points[points.length - 1]!;
      if (end === 'drop') fire('drop', last);
      if (end === 'leave') fire('dragleave', last);
    },
    { payload, points, end },
  );
}

/**
 * The middle of a slice, worked out from the wheel's own geometry. The
 * slices pop in with a CSS animation, and WebKit does not always advance it
 * in a headless test browser, so the labels' on-screen positions cannot be
 * trusted. The <svg> box itself is never animated: its centre is the wheel's
 * centre and its width is 2 * (outer radius + 16), as DropWheel draws it.
 */
async function sliceAt(page: Page, id: string): Promise<[number, number]> {
  const box = (await page.getByTestId('wheel').boundingBox())!;
  const outer = box.width / 2 - 16;
  const inner = Math.round(outer * 0.38);
  const ring = Object.values(RINGS).find((r) => r.some((s) => s.id === id))!;
  const index = ring.findIndex((s) => s.id === id);
  const c = sliceCentre(index, ring.length, (outer + inner) / 2);
  return [box.x + box.width / 2 + c.x, box.y + box.height / 2 + c.y];
}

/** Opens the wheel by dragging the files in, then drops them on the slice. */
async function dropOn(page: Page, id: string, items: Drop | Drop[]) {
  const list = Array.isArray(items) ? items : [items];
  await drag(page, list, [[640, 360]], 'none');
  await expect(page.getByTestId(`wheel-${id}`)).toBeVisible();
  await drag(page, list, [await sliceAt(page, id)]);
}

/** Names of the files stored in a ZIP (ILMPDF's ZIPs are stored, not compressed, so names are plain bytes). */
const zipText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const png = (name: string): Drop => ({ name, bytes: TINY_PNG, type: 'image/png' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
});

test('wheel: appears when a file is dragged in, highlights the slice under the cursor, and leaves quietly', async ({ page }) => {
  const item = { name: 'report.pdf', bytes: makePdf(1) };
  await drag(page, [item], [[640, 360]], 'none');
  await expect(page.getByTestId('wheel')).toBeVisible();
  await expect(page.locator('[data-testid^="wheel-label-"]')).toHaveCount(7);

  await drag(page, [item], [await sliceAt(page, 'text')], 'none');
  await expect(page.getByTestId('wheel-text')).toHaveClass(/hot/);
  await expect(page.getByTestId('wheel-hint')).toHaveText('Save the text as a .txt file');

  await drag(page, [item], [[0, 0]], 'leave');
  await expect(page.getByTestId('drop-wheel')).toHaveCount(0);
});

test('wheel: dropping outside the slices does nothing', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  const item = { name: 'report.pdf', bytes: makePdf(1) };
  await drag(page, [item], [[640, 360]], 'none');
  await drag(page, [item], [[20, 780]]);
  await expect(page.getByTestId('drop-wheel')).toHaveCount(0);
  await expect(page.getByTestId('wheel-tip')).toBeVisible(); // still on the home page
  expect(downloads).toBe(0);
});

test('wheel: Text saves the words of the PDF, with no network use', async ({ page }) => {
  const requests = trackRequests(page);
  const download = page.waitForEvent('download');
  await dropOn(page, 'text', { name: 'letter.pdf', bytes: makeScriptedPdf() });
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('letter.txt');
  expect(new TextDecoder().decode(await bytesOf(saved))).toContain('Hello sanitize');
  await expect(page.getByTestId('notice-ok')).toContainText('Saved the text of 1 page as letter.txt');
  expect(offOrigin(requests)).toEqual([]);
});

test('wheel: PNG saves one page as an image, and several pages as one ZIP', async ({ page }) => {
  let download = page.waitForEvent('download');
  await dropOn(page, 'png', { name: 'one.pdf', bytes: makePdf(1) });
  expect((await download).suggestedFilename()).toBe('one-page-1.png');

  await page.getByRole('button', { name: 'Close this note' }).click();
  download = page.waitForEvent('download');
  await dropOn(page, 'jpg', { name: 'two.pdf', bytes: makePdf(2) });
  const zip = await download;
  expect(zip.suggestedFilename()).toBe('two-pages-jpg.zip');
  const bytes = await bytesOf(zip);
  expect(new TextDecoder().decode(bytes)).toContain('two-page-2.jpg');
  await expect(page.getByTestId('notice-ok')).toContainText('Saved 2 pages as JPG images');
});

test('wheel: Clean removes hidden details and scripts', async ({ page }) => {
  const download = page.waitForEvent('download');
  await dropOn(page, 'clean', { name: 'risky.pdf', bytes: await get('20-with-scripts.pdf') });
  expect((await download).suggestedFilename()).toBe('risky-clean.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Removed the hidden author, title and app details, and');
  await expect(page.getByTestId('notice-ok')).toContainText('script');
});

test('wheel: Flatten bakes in form fields and comments', async ({ page }) => {
  const download = page.waitForEvent('download');
  await dropOn(page, 'flatten', { name: 'filled.pdf', bytes: await get('31-flatten-form-and-comments.pdf') });
  expect((await download).suggestedFilename()).toBe('filled-flattened.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Flattened 5 form fields and 5 comments');
});

test('wheel: a file that is not a PDF is refused', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await dropOn(page, 'compress', { name: 'notes.txt', bytes: new TextEncoder().encode('hello'), type: 'text/plain' });
  await expect(page.getByTestId('notice-error')).toContainText('notes.txt: Not a .pdf file');
  expect(downloads).toBe(0);
});

test('wheel: several PDFs get their own ring, and Merge joins them', async ({ page }) => {
  const two = [
    { name: 'a.pdf', bytes: makePdf(1) },
    { name: 'b.pdf', bytes: makePdf(2) },
  ];
  await drag(page, two, [[640, 360]], 'none');
  await expect(page.locator('[data-testid^="wheel-label-"]')).toHaveCount(6);
  await expect(page.getByTestId('wheel-hint')).toContainText('2 PDFs');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drop-wheel')).toHaveCount(0);

  const download = page.waitForEvent('download');
  await dropOn(page, 'merge', two);
  expect((await download).suggestedFilename()).toBe('merged.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Merged 2 PDFs (3 pages)');
});

test('wheel: Compress all and Text all save one ZIP, and say which files were skipped', async ({ page }) => {
  const requests = trackRequests(page);
  let download = page.waitForEvent('download');
  await dropOn(page, 'compressAll', [
    { name: 'one.pdf', bytes: makePdf(1) },
    { name: 'two.pdf', bytes: makePdf(2) },
  ]);
  let zip = await download;
  expect(zip.suggestedFilename()).toBe('ilmpdf-batch-compressed.zip');
  expect(zipText(await bytesOf(zip))).toContain('ilmpdf-batch-report.txt');

  await page.getByRole('button', { name: 'Close this note' }).click();
  download = page.waitForEvent('download');
  await dropOn(page, 'textAll', [
    { name: 'letter.pdf', bytes: makeScriptedPdf() },
    { name: 'blank.pdf', bytes: makePdf(1) },
  ]);
  zip = await download;
  expect(zip.suggestedFilename()).toBe('ilmpdf-text.zip');
  const inside = zipText(await bytesOf(zip));
  expect(inside).toContain('letter.txt');
  expect(inside).toContain('Hello sanitize');
  await expect(page.getByTestId('notice-ok')).toContainText('Saved 1 text file in ilmpdf-text.zip. Skipped blank.pdf');
  expect(offOrigin(requests)).toEqual([]);
});

test('wheel: images get their own ring and become one PDF', async ({ page }) => {
  await drag(page, [png('a.png'), png('b.png')], [[640, 360]], 'none');
  await expect(page.locator('[data-testid^="wheel-label-"]')).toHaveCount(3);
  await expect(page.getByTestId('wheel-hint')).toContainText('2 images');
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await dropOn(page, 'imgFit', [png('a.png'), png('b.png')]);
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe('images.pdf');
  expect(zipText((await bytesOf(pdf)).subarray(0, 5))).toBe('%PDF-');
  await expect(page.getByTestId('notice-ok')).toContainText('Made a 2-page PDF');
});

test('wheel: a drop that does not match the ring shown is explained, or mapped when it is safe', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  const one = { name: 'a.pdf', bytes: makePdf(1) };
  const two = [one, { name: 'b.pdf', bytes: makePdf(1) }];

  // The browser said one PDF, but two were dropped on Flatten, which has no several-PDFs twin.
  await drag(page, [one], [[640, 360]], 'none');
  await drag(page, two, [await sliceAt(page, 'flatten')]);
  await expect(page.getByTestId('notice-error')).toContainText('Drag them in again');

  // PDFs and images together are refused.
  await page.getByRole('button', { name: 'Close this note' }).click();
  await drag(page, [one, png('c.png')], [[640, 360]], 'none');
  await drag(page, [one, png('c.png')], [await sliceAt(page, 'merge')]);
  await expect(page.getByTestId('notice-error')).toContainText('only PDFs or only images');
  expect(downloads).toBe(0);

  // Two PDFs dropped on the one-PDF Text slice run Text all instead.
  await page.getByRole('button', { name: 'Close this note' }).click();
  const download = page.waitForEvent('download');
  await drag(page, [one], [[640, 360]], 'none');
  await drag(page, [{ name: 'x.pdf', bytes: makeScriptedPdf() }, { name: 'y.pdf', bytes: makeScriptedPdf() }], [await sliceAt(page, 'text')]);
  expect((await download).suggestedFilename()).toBe('ilmpdf-text.zip');
  await expect(page.getByTestId('notice-ok')).toContainText('Saved 2 text files');
});

test('wheel: stays off on tool pages, which have their own drop areas', async ({ page }) => {
  await page.goto('/#/merge');
  await expect(page.getByTestId('tool-merge')).toBeVisible();
  await drag(page, [{ name: 'a.pdf', bytes: makePdf(1) }], [[640, 360]], 'none');
  await expect(page.getByTestId('drop-wheel')).toHaveCount(0);
});
