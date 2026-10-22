import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';

function watchCsp(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // The app's own offline self-check is meant to be refused, so it doesn't count.
    const probe = m.text().includes('__ilmpdf_network_probe');
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && !probe) errors.push(m.text());
  });
  return errors;
}

/** Two 400 x 300 pages, each with a secret line in the top quarter and a public line at the bottom. */
async function letterPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const page = doc.addPage([400, 300]);
    page.drawText(`SECRET-WORD ${i}`, { x: 40, y: 250, size: 20, font });
    page.drawText(`public line ${i}`, { x: 40, y: 40, size: 20, font });
  }
  return doc.save();
}

function textOf(bytes: Uint8Array): string[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pages = Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText('').asText());
  doc.destroy();
  return pages;
}

async function drawBox(page: Page, from: [number, number], to: [number, number]) {
  const preview = page.getByTestId('page-preview');
  // Wait until the page has finished drawing, so the drag lands in the right place.
  await expect(preview).toHaveAttribute('data-ready', 'true');
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

test('redact: a drawn box removes the text under it from the file', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  const csp = watchCsp(page);
  await openTool(page, 'redact');
  await addPdf(page, 'letter.pdf', await letterPdf());
  await drawBox(page, [0.02, 0.05], [0.9, 0.25]);
  await expect(page.getByTestId('mark')).toHaveCount(1);
  await expect(page.getByTestId('mark-summary')).toContainText('1 area marked on 1 page');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('letter-redacted.pdf');
  const [first, second] = textOf(await bytesOf(saved!));
  expect(first).not.toContain('SECRET');
  expect(first).toContain('public line 1');
  // Only the page that was marked changes.
  expect(second).toContain('SECRET-WORD 2');
  await expect(page.getByText(/Redacted 1 area on 1 page/)).toBeVisible();
  expect(offOrigin(requests)).toEqual([]);
  expect(csp).toEqual([]);
});

test('redact: "Mark all" finds text on every page, and marks can be removed', async ({ page }) => {
  test.slow();
  await openTool(page, 'redact');
  await addPdf(page, 'letter.pdf', await letterPdf());
  await page.getByTestId('find-text').fill('secret-word');
  await page.getByTestId('find').click();
  await expect(page.getByText('Marked 2 matches on 2 pages.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('mark')).toHaveCount(1); // one on this page
  await expect(page.getByTestId('mark-summary')).toContainText('2 areas marked on 2 pages');

  // Clicking a mark unmarks it; mark it again by drawing.
  await page.getByTestId('mark').click();
  await expect(page.getByTestId('mark-summary')).toContainText('1 area marked on 1 page');
  await drawBox(page, [0.05, 0.08], [0.7, 0.22]);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  const pages = textOf(await bytesOf(saved!));
  pages.forEach((text, i) => {
    expect(text).not.toContain('SECRET');
    expect(text).toContain(`public line ${i + 1}`);
  });
});

test('redact: says so when the text is not found', async ({ page }) => {
  await openTool(page, 'redact');
  await addPdf(page, 'letter.pdf', await letterPdf());
  await page.getByTestId('find-text').fill('nowhere');
  await page.getByTestId('find').click();
  await expect(page.getByText('"nowhere" was not found.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('run')).toBeDisabled();
});

/** A 400 x 300 page with a secret line, a field holding the secret, and two attached files. */
async function extrasPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('SECRET-WORD', { x: 40, y: 250, size: 20, font });
  page.drawText('public line', { x: 40, y: 40, size: 20, font });
  const field = doc.getForm().createTextField('notes');
  field.setText('Holds SECRET-WORD too');
  field.addToPage(page, { x: 40, y: 140, width: 250, height: 30 });
  await doc.attach(new TextEncoder().encode('SECRET-WORD in a file'), 'secret.txt', { mimeType: 'text/plain' });
  // Bytes that aren't text, so the contents can't be checked.
  await doc.attach(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), 'picture.png', { mimeType: 'image/png' });
  return doc.save();
}

test('redact: "Mark all" finds form fields, and matching attached files are removed', async ({ page }) => {
  test.slow();
  await openTool(page, 'redact');
  await addPdf(page, 'extras.pdf', await extrasPdf());
  await page.getByTestId('find-text').fill('secret-word');
  await page.getByTestId('find').click();
  await expect(page.getByText('Marked 2 matches (1 in form field) on 1 page.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('mark')).toHaveCount(2);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  await expect(page.getByText('Also removed 1 attached file that mentioned the redacted text.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('notice-info')).toContainText('Kept "picture.png"');
  const pdf = mupdf.Document.openDocument(await bytesOf(saved!), 'application/pdf').asPDF()!;
  expect(Object.keys(pdf.getEmbeddedFiles())).toEqual(['picture.png']);
  expect((pdf.loadPage(0) as mupdf.PDFPage).getWidgets()).toHaveLength(0);
  pdf.destroy();
});
