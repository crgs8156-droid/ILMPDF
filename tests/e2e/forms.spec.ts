import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const form = async () => (await files).find((f) => f.name === '15-form.pdf')!.bytes;

async function fill(page: import('@playwright/test').Page) {
  await page.getByTestId('field-full_name').fill('Ada Lovelace');
  await page.getByTestId('field-email').fill('ada@example.com');
  await page.getByTestId('field-subscribe').check();
  await page.getByTestId('field-plan').selectOption('Pro');
  await page.getByTestId('field-size-1').check();
}

test('forms: fill in every kind of field and save an editable copy', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'forms');
  await addPdf(page, 'application.pdf', await form());
  await fill(page);

  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('application-filled.pdf');
  const out = (await PDFDocument.load(await bytesOf(saved!))).getForm();
  expect(out.getTextField('full_name').getText()).toBe('Ada Lovelace');
  expect(out.getTextField('email').getText()).toBe('ada@example.com');
  expect(out.getCheckBox('subscribe').isChecked()).toBe(true);
  expect(out.getDropdown('plan').getSelected()).toEqual(['Pro']);
  expect(out.getRadioGroup('size').getSelected()).toBe('Large');
  expect(offOrigin(requests)).toEqual([]);
});

test('forms: flatten removes the fields', async ({ page }) => {
  await openTool(page, 'forms');
  await addPdf(page, 'application.pdf', await form());
  await fill(page);
  await page.getByTestId('flatten').check();
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('application-flattened.pdf');
  expect((await PDFDocument.load(await bytesOf(saved!))).getForm().getFields()).toHaveLength(0);
});

test('forms: a PDF without fields says so', async ({ page }) => {
  await openTool(page, 'forms');
  await addPdf(page, 'plain.pdf', makePdf(2));
  await expect(page.getByTestId('no-fields')).toBeVisible();
});
