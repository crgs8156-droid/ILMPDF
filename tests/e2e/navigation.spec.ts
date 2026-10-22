import { expect, test } from './fixtures';
import { addPdf, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

test.beforeEach(async ({ page }) => {
  const requests = trackRequests(page);
  (page as unknown as { __requests: typeof requests }).__requests = requests;
});

test.afterEach(async ({ page }) => {
  const requests = (page as unknown as { __requests: Parameters<typeof offOrigin>[0] }).__requests;
  expect(offOrigin(requests), 'no request may leave the local server').toEqual([]);
});

test('the tab title names the open tool', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ILMPDF');
  await page.getByTestId('open-compress').click();
  await expect(page).toHaveTitle('Compress PDF · ILMPDF');
  await expect(page.getByTestId('breadcrumb')).toContainText('Optimize');
  await expect(page.getByRole('heading', { name: 'Compress PDF' })).toBeFocused();
});

test('browser Back steps from a loaded file to the picker, then home', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-compress').click();
  await addPdf(page, 'a.pdf', makePdf(2));
  await expect(page.getByTestId('loaded-file')).toContainText('a.pdf');
  await expect(page).toHaveURL(/#\/compress\/file$/);

  await page.goBack();
  await expect(page).toHaveURL(/#\/compress$/);
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
  await expect(page.getByTestId('file-input')).toBeAttached();

  await page.goBack();
  await expect(page.getByTestId('open-compress')).toBeVisible();
  await expect(page.getByTestId('open-compress')).toBeFocused();
});

test('Forward to a closed file explains that it was not kept', async ({ page }) => {
  await openTool(page, 'compress');
  await addPdf(page, 'a.pdf', makePdf(1));
  await expect(page.getByTestId('loaded-file')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId('notice-info')).toContainText('never keeps files');
  await expect(page).toHaveURL(/#\/compress$/);
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
});

test('the Back button and "Choose another file" use the same steps', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-sign').click();
  await addPdf(page, 'a.pdf', makePdf(1));
  await expect(page.getByTestId('back')).toHaveText('‹ Back');
  await page.getByTestId('loaded-file').getByRole('button', { name: 'Choose another file' }).click();
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
  await expect(page.getByTestId('back')).toContainText('All tools');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('open-sign')).toBeVisible();
  // Both steps used the browser's own Back, so Forward returns to the tool.
  await page.goForward();
  await expect(page.getByTestId('tool-sign')).toBeVisible();
});

test('Back from a direct link goes home', async ({ page }) => {
  await openTool(page, 'merge');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('open-merge')).toBeVisible();
});

test('Esc leaves a tool only before a file is loaded', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-compress').click();
  await addPdf(page, 'a.pdf', makePdf(1));
  await expect(page.getByTestId('loaded-file')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('loaded-file')).toBeVisible();

  await page.getByTestId('back').click();
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('open-compress')).toBeVisible();
});

test('an unknown address shows a not-found page with a way home', async ({ page }) => {
  await page.goto('/#/no-such-tool');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await expect(page).toHaveTitle('Not found · ILMPDF');
  await page.getByTestId('not-found-home').click();
  await expect(page.getByTestId('open-merge')).toBeVisible();
});

test('reloading on a file step returns to the picker', async ({ page }) => {
  await page.goto('/#/compress/file');
  await expect(page.getByTestId('notice-info')).toContainText('never keeps files');
  await expect(page).toHaveURL(/#\/compress$/);
});
