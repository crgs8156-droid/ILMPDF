import { expect, test, type Page } from '@playwright/test';
import { bytesOf, offOrigin, trackRequests } from './helpers';
import { makePdf, makeScriptedPdf } from '../fixtures/make-pdf';
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
  return page.evaluate(
    ({ payload, points, end }) => {
      const seen: unknown[] = [];
      const dt = new DataTransfer();
      for (const f of payload) dt.items.add(new File([new Uint8Array(f.data)], f.name, { type: f.type }));
      const fire = (type: string, [x, y]: [number, number]) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
        // WebKit leaves a script-made drag event's position at 0, 0, so set it directly.
        Object.defineProperty(event, 'clientX', { value: x });
        Object.defineProperty(event, 'clientY', { value: y });
        document.body.dispatchEvent(event);
        seen.push({ type, x: event.clientX, y: event.clientY, types: Array.from(event.dataTransfer?.types ?? []), prevented: event.defaultPrevented });
      };
      fire('dragenter', points[0]!);
      for (const p of points) fire('dragover', p);
      const last = points[points.length - 1]!;
      if (end === 'drop') fire('drop', last);
      if (end === 'leave') fire('dragleave', last);
      return seen;
    },
    { payload, points, end },
  );
}

/** The middle of a slice's label, which always lies inside the slice. */
async function sliceAt(page: Page, id: string): Promise<[number, number]> {
  // Wait for the pop-in animation, which starts the slices smaller and nearer the centre.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const box = (await page.getByTestId(`wheel-label-${id}`).boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Opens the wheel by dragging in at (x, y), then drops on the slice. */
async function dropOn(page: Page, id: string, item: Drop) {
  await drag(page, [item], [[640, 360]], 'none');
  await expect(page.getByTestId('wheel')).toBeVisible();
  await drag(page, [item], [await sliceAt(page, id)]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
});

test('wheel: appears when a file is dragged in, highlights the slice under the cursor, and leaves quietly', async ({ page }) => {
  const item = { name: 'report.pdf', bytes: makePdf(1) };
  await drag(page, [item], [[640, 360]], 'none');
  await expect(page.getByTestId('wheel')).toBeVisible();
  await expect(page.locator('[data-testid^="wheel-label-"]')).toHaveCount(7);

  const at = await sliceAt(page, 'text');
  const seen = await drag(page, [item], [at], 'none');
  // TEMP diagnostics for WebKit in CI.
  const dom = await page.evaluate(() => ({
    hint: document.querySelector('[data-testid=wheel-hint]')?.textContent,
    svg: document.querySelector('[data-testid=wheel]')?.getBoundingClientRect().toJSON(),
    label: document.querySelector('[data-testid=wheel-label-text]')?.getBoundingClientRect().toJSON(),
    hot: Array.from(document.querySelectorAll('.slice.hot')).map((g) => g.getAttribute('data-testid')),
  }));
  console.log('WHEEL-DIAG', JSON.stringify({ at, seen, dom }));
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

test('wheel: a file that is not a PDF is refused, and several files are not run', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await dropOn(page, 'compress', { name: 'notes.txt', bytes: new TextEncoder().encode('hello'), type: 'text/plain' });
  await expect(page.getByTestId('notice-error')).toContainText('notes.txt: Not a .pdf file');

  const two = [{ name: 'a.pdf', bytes: makePdf(1) }, { name: 'b.pdf', bytes: makePdf(1) }];
  await drag(page, two, [[640, 360]], 'none');
  await expect(page.getByTestId('wheel-hint')).toHaveText('The wheel takes one PDF at a time for now');
  await drag(page, two, [await sliceAt(page, 'compress')]);
  await expect(page.getByTestId('notice-error')).toContainText('one PDF at a time');
  expect(downloads).toBe(0);
});

test('wheel: stays off on tool pages, which have their own drop areas', async ({ page }) => {
  await page.goto('/#/merge');
  await expect(page.getByTestId('tool-merge')).toBeVisible();
  await drag(page, [{ name: 'a.pdf', bytes: makePdf(1) }], [[640, 360]], 'none');
  await expect(page.getByTestId('drop-wheel')).toHaveCount(0);
});
