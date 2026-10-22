import { expect, test } from './fixtures';
import * as mupdf from 'mupdf';
import { addPdf, bytesOf, collectDownloads, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { inspect } from '../../src/engines/mupdf-ops';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const files: Promise<{ name: string; bytes: Uint8Array }[]> = buildTestFiles();
const get = async (name: string) => (await files).find((f) => f.name === name)!.bytes;

test('unlock: wrong password is refused, right password saves an open copy', async ({ page }) => {
  test.slow();
  const requests = trackRequests(page);
  await openTool(page, 'unlock');
  await addPdf(page, 'locked.pdf', await get('14-password-aes256-is-test.pdf'));
  await expect(page.getByTestId('loaded-file')).toContainText('Needs a password');

  await page.getByTestId('password').fill('wrong');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('notice-error')).toContainText('That password is not correct.');
  await expect(page.getByTestId('password')).toHaveValue('');

  await page.getByTestId('password').fill('test');
  const [saved] = await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  expect(saved!.suggestedFilename()).toBe('locked-unlocked.pdf');
  expect(inspect(mupdf, await bytesOf(saved!))).toEqual({ pages: 5, encrypted: false, needsPassword: false });
  expect(offOrigin(requests)).toEqual([]);
});

test('unlock: a file without a password gets a clear message', async ({ page }) => {
  await openTool(page, 'unlock');
  await addPdf(page, 'plain.pdf', makePdf(2));
  await expect(page.getByTestId('notice-error')).toContainText("isn't password-protected");
});
