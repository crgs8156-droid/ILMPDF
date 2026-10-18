import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

// Tall enough that the whole page preview fits on screen: the mouse cannot
// reach parts of the page that are scrolled out of view.
test.use({ viewport: { width: 1280, height: 1600 } });

function watchCsp(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // The app's own offline self-check is meant to be refused, so it doesn't count.
    const probe = m.text().includes('__ilmpdf_network_probe');
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && !probe) errors.push(m.text());
  });
  return errors;
}

/** Drags across the page preview between two points given as fractions of it. */
async function dragOn(page: Page, from: [number, number], to: [number, number]) {
  const preview = page.getByTestId('page-preview');
  await preview.scrollIntoViewIfNeeded();
  // Before the page has drawn, the preview has a placeholder size.
  await expect(preview).toHaveAttribute('data-ready', 'true');
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

/** Each annotation in a saved PDF: page, kind, contents and bounds as fractions of the shown page. */
function annotations(bytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const out: { page: number; type: string; contents: string; box: number[] }[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i) as mupdf.PDFPage;
    const [, , w, h] = page.getBounds();
    for (const a of page.getAnnotations()) {
      const [x0, y0, x1, y1] = a.getBounds();
      out.push({ page: i, type: a.getType(), contents: a.getContents(), box: [x0 / w, y0 / h, x1 / w, y1 / h] });
    }
  }
  doc.destroy();
  return out;
}

test('annotate: adds a text box, highlight, rectangle, line and comment', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  const csp = watchCsp(page);
  await openTool(page, 'annotate');
  await addPdf(page, 'notes.pdf', makePdf(2));

  await page.getByTestId('words').fill('Hello there');
  await dragOn(page, [0.1, 0.1], [0.6, 0.25]);

  await page.getByTestId('tool-btn-highlight').click();
  await dragOn(page, [0.1, 0.4], [0.8, 0.45]);
  await page.getByTestId('tool-btn-rect').click();
  await dragOn(page, [0.2, 0.6], [0.5, 0.8]);

  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-label')).toHaveText('Page 2 of 2');
  await page.getByTestId('tool-btn-line').click();
  await page.getByTestId('color-blue').click();
  await dragOn(page, [0.1, 0.9], [0.9, 0.5]);
  await page.getByTestId('tool-btn-note').click();
  await page.getByTestId('words').fill('Check this figure');
  await dragOn(page, [0.7, 0.1], [0.7, 0.1]);
  await expect(page.getByTestId('item-list').locator('li')).toHaveCount(2);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('notes-annotated.pdf');
  const found = annotations(await bytesOf(saved!));
  expect(found.map((a) => [a.page, a.type])).toEqual([
    [0, 'FreeText'],
    [0, 'Highlight'],
    [0, 'Square'],
    [1, 'Line'],
    [1, 'Text'],
  ]);
  expect(found[0]!.contents).toBe('Hello there');
  expect(found[4]!.contents).toBe('Check this figure');
  // The text box sits where it was drawn (allowing for mouse rounding).
  const [x0, y0, x1, y1] = found[0]!.box;
  expect(x0).toBeCloseTo(0.1, 1);
  expect(y0).toBeCloseTo(0.1, 1);
  expect(x1).toBeCloseTo(0.6, 1);
  expect(y1).toBeCloseTo(0.25, 1);
  expect(offOrigin(requests)).toEqual([]);
  expect(csp).toEqual([]);
});

test('annotate: an item can be moved and deleted', async ({ page }) => {
  await openTool(page, 'annotate');
  await addPdf(page, 'doc.pdf', makePdf(1));
  await page.getByTestId('tool-btn-rect').click();
  await dragOn(page, [0.1, 0.1], [0.3, 0.3]);
  await dragOn(page, [0.6, 0.6], [0.8, 0.8]);
  await expect(page.getByTestId('item-list').locator('li')).toHaveCount(2);

  // Move the first rectangle down by 40% of the page.
  await page.getByTestId('tool-btn-move').click();
  await dragOn(page, [0.1, 0.2], [0.1, 0.6]);
  // Select the second one and delete it with the keyboard.
  await dragOn(page, [0.8, 0.7], [0.8, 0.7]);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('item-list').locator('li')).toHaveCount(1);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const found = annotations(await bytesOf(saved!));
  expect(found).toHaveLength(1);
  expect(found[0]!.box[1]).toBeCloseTo(0.5, 1);
  expect(found[0]!.box[3]).toBeCloseTo(0.7, 1);
});

test('annotate: a text box needs its text first', async ({ page }) => {
  await openTool(page, 'annotate');
  await addPdf(page, 'doc.pdf', makePdf(1));
  await dragOn(page, [0.1, 0.1], [0.5, 0.3]);
  await expect(page.getByText('Type the text for the box first.')).toBeVisible();
  await expect(page.getByTestId('run')).toBeDisabled();
});

/** Moves the mouse along a path of points on the page preview with the button held down. */
async function drawPath(page: Page, path: [number, number][]) {
  const preview = page.getByTestId('page-preview');
  await expect(preview).toHaveAttribute('data-ready', 'true');
  const box = (await preview.boundingBox())!;
  const at = ([fx, fy]: [number, number]) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await page.mouse.move(...at(path[0]!));
  await page.mouse.down();
  for (const p of path.slice(1)) await page.mouse.move(...at(p), { steps: 4 });
  await page.mouse.up();
}

/** The raw PDF dictionary of every annotation, to check arrowheads and ink paths. */
function rawAnnots(bytes: Uint8Array): string[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const page = doc.loadPage(0) as mupdf.PDFPage;
  const out = page.getAnnotations().map((a) => a.getObject().resolve().toString());
  doc.destroy();
  return out;
}

test('annotate: adds an arrow and a freehand drawing', async ({ page }) => {
  test.slow();
  const csp = watchCsp(page);
  await openTool(page, 'annotate');
  await addPdf(page, 'sketch.pdf', makePdf(1));

  await page.getByTestId('tool-btn-arrow').click();
  await dragOn(page, [0.1, 0.8], [0.6, 0.3]);
  await page.getByTestId('tool-btn-ink').click();
  await drawPath(page, [
    [0.2, 0.2],
    [0.4, 0.1],
    [0.6, 0.2],
    [0.8, 0.1],
  ]);
  await expect(page.getByTestId('item-list').locator('li')).toHaveText([/Arrow/, /Freehand drawing/]);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const bytes = await bytesOf(saved!);
  const found = annotations(bytes);
  expect(found.map((a) => a.type)).toEqual(['Line', 'Ink']);
  expect(rawAnnots(bytes)[0]).toMatch(/\/LE\s*\[\s*\/None\s*\/OpenArrow\s*\]/);
  // The drawing spans the path it was drawn along (allowing for the line width).
  const [x0, y0, x1, y1] = found[1]!.box;
  expect(x0).toBeCloseTo(0.2, 1);
  expect(x1).toBeCloseTo(0.8, 1);
  expect(y0).toBeCloseTo(0.1, 1);
  expect(y1).toBeCloseTo(0.2, 1);
  expect(csp).toEqual([]);
});

test('annotate: resize handles change a rectangle, an arrow and a drawing', async ({ page }) => {
  test.slow();
  await openTool(page, 'annotate');
  await addPdf(page, 'resize.pdf', makePdf(1));
  await page.getByTestId('tool-btn-rect').click();
  await dragOn(page, [0.1, 0.1], [0.3, 0.3]);
  await page.getByTestId('tool-btn-arrow').click();
  await dragOn(page, [0.1, 0.5], [0.4, 0.5]);
  await page.getByTestId('tool-btn-ink').click();
  await drawPath(page, [
    [0.5, 0.7],
    [0.6, 0.8],
    [0.7, 0.7],
  ]);

  await page.getByTestId('tool-btn-move').click();
  // Select the rectangle, then drag its bottom-right corner out.
  await dragOn(page, [0.1, 0.2], [0.1, 0.2]);
  await expect(page.locator('[data-handle]')).toHaveCount(8);
  await dragOn(page, [0.3, 0.3], [0.5, 0.4]);
  // Select the arrow, then drag its point to the right.
  await dragOn(page, [0.25, 0.5], [0.25, 0.5]);
  await expect(page.locator('[data-handle]')).toHaveCount(2);
  await dragOn(page, [0.4, 0.5], [0.9, 0.5]);
  // Select the drawing, then drag its right edge to double its width.
  await dragOn(page, [0.6, 0.8], [0.6, 0.8]);
  await dragOn(page, [0.7, 0.75], [0.9, 0.75]);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const [rect, arrow, ink] = annotations(await bytesOf(saved!));
  expect(rect!.box[2]).toBeCloseTo(0.5, 1);
  expect(rect!.box[3]).toBeCloseTo(0.4, 1);
  expect(arrow!.box[2]).toBeCloseTo(0.9, 1);
  expect(ink!.box[0]).toBeCloseTo(0.5, 1);
  expect(ink!.box[2]).toBeCloseTo(0.9, 1);
});
