import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { open } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

/** Annotation and form-field counts of the first page, plus whether a form remains. */
function inspectSaved(bytes: Uint8Array) {
  const doc = open(mupdf, bytes);
  const page = doc.loadPage(0);
  const result = {
    annots: page.getAnnotations().length,
    widgets: page.getWidgets().length,
    links: page.getLinks().length,
    form: !doc.getTrailer().get('Root').get('AcroForm').isNull(),
  };
  page.destroy();
  doc.destroy();
  return result;
}

test('flatten: bakes form fields and comments and saves a copy', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'flatten');
  await addPdf(page, 'filled.pdf', await get('31-flatten-form-and-comments.pdf'));
  await expect(page.getByTestId('loaded-file')).toContainText('filled.pdf');

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('filled-flattened.pdf');
  await expect(page.getByTestId('notice-ok')).toContainText('Flattened 5 form fields and 5 annotations');
  expect(inspectSaved(await bytesOf(saved!))).toEqual({ annots: 0, widgets: 0, links: 0, form: false });
  expect(offOrigin(requests)).toEqual([]);
});

test('flatten: only comments, keeping the form and the links', async ({ page }) => {
  await openTool(page, 'flatten');
  await addPdf(page, 'links.pdf', await get('32-flatten-with-links.pdf'));
  await page.getByTestId('flatten-fields').uncheck();
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  await expect(page.getByTestId('notice-ok')).toContainText('Flattened 10 annotations');
  expect(inspectSaved(await bytesOf(saved!))).toMatchObject({ annots: 0, links: 2 });
});

test('flatten: nothing ticked disables the button; nothing to flatten says so', async ({ page }) => {
  await openTool(page, 'flatten');
  await addPdf(page, 'plain.pdf', makePdf(2));
  await page.getByTestId('flatten-fields').uncheck();
  await page.getByTestId('flatten-annotations').uncheck();
  await expect(page.getByTestId('run')).toBeDisabled();
  await page.getByTestId('flatten-annotations').check();
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('Nothing to flatten');
  await expect(page.getByTestId('run')).toBeEnabled();
});
