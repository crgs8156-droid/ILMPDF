import { expect, test } from './fixtures';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf, makeScriptedPdf } from '../fixtures/make-pdf';
import { open, sanitize } from '../../src/engines/mupdf-ops';

test('remove scripts: reports what it removed and saves a clean copy', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  // If the page ever ran a script from the PDF, an alert would appear.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openTool(page, 'remove-scripts');
  await addPdf(page, 'scripted.pdf', makeScriptedPdf());
  await expect(page.getByTestId('loaded-file')).toContainText('scripted.pdf');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('scripted-clean.pdf');
  const notice = page.getByTestId('notice-ok');
  await expect(notice).toContainText('6 scripts');
  await expect(notice).toContainText('2 attached files');
  await expect(notice).toContainText('an XFA form layer');

  const clean = await bytesOf(saved!);
  expect(sanitize(mupdf, clean).file).toBeNull();
  const doc = open(mupdf, clean);
  expect(doc.countPages()).toBe(1);
  doc.destroy();
  expect(dialogs).toEqual([]);
  expect(offOrigin(requests)).toEqual([]);
});

test('remove scripts: a clean PDF saves nothing and says so', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await openTool(page, 'remove-scripts');
  await addPdf(page, 'plain.pdf', makePdf(2));
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-ok')).toContainText('Nothing to remove');
  expect(downloads).toBe(0);
});

test('remove scripts: a locked PDF gets a clear message', async ({ page }) => {
  await openTool(page, 'remove-scripts');
  await addPdf(page, 'locked.pdf', makePdf(1, { encrypted: true }));
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('Unlock it first');
  await expect(page.getByTestId('run')).toBeEnabled();
});
