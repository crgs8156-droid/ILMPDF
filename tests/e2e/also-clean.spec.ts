import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf, makeScriptedPdf } from '../fixtures/make-pdf';
import { inspect, protect, sanitize, unlock } from '../../src/engines/mupdf-ops';

// The "Also remove scripts" checkbox in the tools that save a PDF. The
// scripted test file only holds harmless stand-ins (see make-pdf.ts).

/** True when the Remove scripts engine still finds something to remove. */
const hasScripts = (bytes: Uint8Array) => sanitize(mupdf, bytes).file !== null;

async function saveOne(page: Page): Promise<Uint8Array> {
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  return bytesOf(saved!);
}

test('also remove scripts: off by default, and the file keeps its scripts', async ({ page }) => {
  await openTool(page, 'watermark');
  await addPdf(page, 'scripted.pdf', makeScriptedPdf());
  await expect(page.getByTestId('also-clean')).not.toBeChecked();
  const out = await saveOne(page);
  expect(hasScripts(out)).toBe(true);
  await expect(page.getByTestId('notice-ok')).not.toContainText('Also removed');
});

test('also remove scripts: watermark saves a clean file and says what went', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openTool(page, 'watermark');
  await addPdf(page, 'scripted.pdf', makeScriptedPdf());
  await page.getByTestId('also-clean').check();
  const out = await saveOne(page);
  expect(hasScripts(out)).toBe(false);
  await expect(page.getByTestId('notice-ok')).toContainText('Watermarked 1 pages. Also removed');
  expect(dialogs).toEqual([]);
  expect(offOrigin(requests)).toEqual([]);
});

test('also remove scripts: merge cleans the merged file', async ({ page }) => {
  test.slow();
  await openTool(page, 'merge');
  await addPdf(page, 'a.pdf', makeScriptedPdf());
  await addPdf(page, 'b.pdf', makePdf(2));
  await expect(page.getByTestId('merge-row')).toHaveCount(2);
  await page.getByTestId('also-clean').check();
  const out = await saveOne(page);
  expect(hasScripts(out)).toBe(false);
  const doc = mupdf.PDFDocument.openDocument(out, 'application/pdf');
  expect(doc.countPages()).toBe(3);
  doc.destroy();
  await expect(page.getByTestId('notice-ok')).toContainText('Also removed');
});

test('also remove scripts: a file with nothing to remove is saved and says so', async ({ page }) => {
  await openTool(page, 'split');
  await addPdf(page, 'plain.pdf', makePdf(3));
  await page.getByTestId('split-spec').fill('1, 2-3');
  await page.getByTestId('also-clean').check();
  const saved = await collectDownloads(page, () => page.getByTestId('run').click(), 2);
  expect(saved.map((d) => d.suggestedFilename())).toEqual(['plain-part-1.pdf', 'plain-part-2.pdf']);
  await expect(page.getByTestId('notice-ok')).toContainText('Created 2 PDFs. No scripts or attached files were found.');
});

test('also remove scripts: protect cleans first, then adds the password', async ({ page }) => {
  test.slow();
  await openTool(page, 'protect');
  await addPdf(page, 'scripted.pdf', makeScriptedPdf());
  await page.getByTestId('password').fill('s3cret, really');
  await page.getByTestId('confirm').fill('s3cret, really');
  await page.getByTestId('also-clean').check();
  const out = await saveOne(page);
  expect(inspect(mupdf, out)).toMatchObject({ encrypted: true, needsPassword: true });
  expect(hasScripts(unlock(mupdf, out, 's3cret, really'))).toBe(false);
  await expect(page.getByTestId('notice-ok')).toContainText('(AES-256). Also removed');
});

test('also remove scripts: unlock cleans the unlocked copy', async ({ page }) => {
  test.slow();
  const locked = protect(mupdf, makeScriptedPdf(), { password: 'open sesame', allowPrint: true, allowCopy: true, allowEdit: true });
  await openTool(page, 'unlock');
  await addPdf(page, 'locked.pdf', locked);
  await page.getByTestId('password').fill('open sesame');
  await page.getByTestId('also-clean').check();
  const out = await saveOne(page);
  expect(inspect(mupdf, out)).toMatchObject({ encrypted: false });
  expect(hasScripts(out)).toBe(false);
  await expect(page.getByTestId('notice-ok')).toContainText('Also removed');
});

test('also remove scripts: compress always saves a clean file when asked', async ({ page }) => {
  test.slow();
  await openTool(page, 'compress');
  await addPdf(page, 'scripted.pdf', makeScriptedPdf());
  await page.getByTestId('level-light').check();
  await page.getByTestId('also-clean').check();
  // A tiny file may not get smaller; then the original is cleaned and saved instead.
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(['scripted-compressed.pdf', 'scripted-clean.pdf']).toContain(saved!.suggestedFilename());
  expect(hasScripts(await bytesOf(saved!))).toBe(false);
  await expect(page.getByTestId('notice-ok')).toContainText('Also removed');
});
