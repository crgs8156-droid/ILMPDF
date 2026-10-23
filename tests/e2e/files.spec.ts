import { expect, test } from './fixtures';
import { addPdf, collectDownloads } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

test('a PDF opened in one tool can be reused in another without choosing it again', async ({ page }) => {
  await page.goto('/#/compress');
  await addPdf(page, 'report.pdf', makePdf(3));
  await expect(page.getByTestId('loaded-file')).toContainText('report.pdf');

  await page.getByTestId('side-files').click();
  await expect(page.getByTestId('side-files')).toContainText('1');
  await expect(page.getByTestId('files-list')).toContainText('report.pdf');
  await expect(page.getByTestId('files-list')).toContainText('3 pages');

  await page.getByTestId('open-in').selectOption('page-numbers');
  await expect(page.getByTestId('tool-page-numbers')).toBeVisible();
  await expect(page.getByTestId('loaded-file')).toContainText('report.pdf');
  await expect(page).toHaveURL(/#\/page-numbers\/file$/);
});

test('the file picker offers your files, and Recent files lists each use', async ({ page }) => {
  await page.goto('/#/compress');
  await addPdf(page, 'a.pdf', makePdf(1));
  await expect(page.getByTestId('loaded-file')).toBeVisible();
  await page.goto('/#/watermark');
  await expect(page.getByTestId('your-files-picker')).toContainText('a.pdf');
  // A reload starts a new, empty session: nothing was kept.
  await page.reload();
  await expect(page.getByTestId('tool-watermark')).toBeVisible();
  await expect(page.getByTestId('your-files-picker')).toHaveCount(0);

  await addPdf(page, 'a.pdf', makePdf(1));
  await expect(page.getByTestId('loaded-file')).toBeVisible();
  await page.getByTestId('side-dashboard').click();
  await page.getByTestId('open-sign').click();
  await page.getByTestId('reuse-file').click();
  await expect(page.getByTestId('loaded-file')).toContainText('a.pdf');

  await page.getByTestId('side-recent').click();
  const rows = page.getByTestId('recent-list').getByTestId('file-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Sign PDF');
  await expect(rows.nth(1)).toContainText('Watermark');
  await rows.nth(1).getByTestId('again').click();
  await expect(page.getByTestId('tool-watermark')).toBeVisible();
  await expect(page.getByTestId('loaded-file')).toContainText('a.pdf');
});

test('results are listed under Saved files and can be saved again', async ({ page }) => {
  await page.goto('/#/page-numbers');
  await addPdf(page, 'doc.pdf', makePdf(2));
  await collectDownloads(page, () => page.getByTestId('run').click(), 1);
  await page.getByTestId('side-saved').click();
  const row = page.getByTestId('saved-list').getByTestId('file-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('From Page numbers');
  const [again] = await collectDownloads(page, () => row.getByTestId('save-again').click(), 1);
  expect(again!.suggestedFilename()).toMatch(/^doc.*\.pdf$/);
  // Saving again is not a new result.
  await expect(row).toHaveCount(1);
});

test('Clear all files asks first, then forgets everything', async ({ page }) => {
  await page.goto('/#/compress');
  await addPdf(page, 'a.pdf', makePdf(1));
  await page.getByTestId('side-files').click();
  await expect(page.getByTestId('files-list')).toBeVisible();
  await page.getByTestId('clear-all').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('files-list')).toBeVisible();
  await page.getByTestId('clear-all').click();
  await page.getByTestId('clear-yes').click();
  await expect(page.getByTestId('files-list')).toHaveCount(0);
  await expect(page.getByTestId('side-files')).toContainText('0');
  await expect(page.getByTestId('clear-all')).toBeDisabled();
});

test('the dashboard shows recent files once there are some', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('recent-list')).toHaveCount(0);
  await page.getByTestId('open-compress').click();
  await addPdf(page, 'a.pdf', makePdf(1));
  await expect(page.getByTestId('loaded-file')).toBeVisible();
  await page.getByTestId('side-dashboard').click();
  await expect(page.getByTestId('recent-list')).toContainText('a.pdf');
  await expect(page).toHaveTitle('ILMPDF');
  await page.getByTestId('see-recent').click();
  await expect(page).toHaveTitle('Recent files · ILMPDF');
});
