import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { inspect } from '../../src/engines/mupdf-ops';

test('protect: saves an AES-256 copy that opens only with the password', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'protect');
  await addPdf(page, 'report.pdf', makePdf(3));

  await page.getByTestId('password').fill('s3cret, really');
  await page.getByTestId('confirm').fill('s3cret, typo');
  await expect(page.getByTestId('mismatch')).toBeVisible();
  await expect(page.getByTestId('run')).toBeDisabled();

  await page.getByTestId('confirm').fill('s3cret, really');
  await page.getByTestId('allow-copy').uncheck();
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('report-protected.pdf');

  const bytes = await bytesOf(saved!);
  expect(inspect(mupdf, bytes)).toMatchObject({ encrypted: true, needsPassword: true });
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  expect(doc.authenticatePassword('wrong')).toBe(0);
  expect(doc.authenticatePassword('s3cret, really')).not.toBe(0);
  expect(doc.hasPermission('print')).toBe(true);
  expect(doc.hasPermission('copy')).toBe(false);
  doc.destroy();

  await expect(page.getByTestId('password')).toHaveValue('');
  expect(offOrigin(requests)).toEqual([]);
});
