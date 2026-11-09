import { expect, test } from './fixtures';
import { addPdf } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

// Auto-clear when idle (src/core/idle.svelte.ts). Playwright's fake clock
// moves time on without waiting 15 real minutes.

test('after 15 minutes without use, files are cleared, with a warning a minute before', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#/compress');
  await addPdf(page, 'report.pdf', makePdf(2));
  await expect(page.getByTestId('loaded-file')).toContainText('report.pdf');

  await page.clock.fastForward('14:05');
  await expect(page.getByTestId('idle-warning')).toBeVisible();
  await page.getByTestId('idle-keep').click();
  await expect(page.getByTestId('idle-warning')).toHaveCount(0);

  // "Keep my files" started a fresh 15 minutes.
  await page.clock.fastForward('10:00');
  await expect(page.getByTestId('loaded-file')).toContainText('report.pdf');

  await page.clock.fastForward('05:05');
  await expect(page.getByTestId('idle-cleared')).toContainText('Files cleared for privacy');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('side-files')).toContainText('0');
  await expect(page.getByTestId('side-saved')).toContainText('0');

  // Back does not return to the page that showed the file.
  await page.getByTestId('open-compress').click();
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
  await expect(page.getByTestId('your-files-picker')).toHaveCount(0);
  await expect(page.getByTestId('idle-cleared')).toHaveCount(0);
});

test('a sleeping Mac or hidden tab clears as soon as the page shows again', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#/compress');
  await addPdf(page, 'report.pdf', makePdf(1));
  await expect(page.getByTestId('loaded-file')).toBeVisible();

  // Sleep: the clock jumps, but no timer runs while the Mac is asleep.
  await page.clock.setSystemTime(Date.now() + 2 * 60 * 60_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByTestId('idle-cleared')).toBeVisible();
  await expect(page.getByTestId('loaded-file')).toHaveCount(0);
});

test('nothing open: no warning and no clear message', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.clock.fastForward('30:00');
  await expect(page.getByTestId('idle-warning')).toHaveCount(0);
  await expect(page.getByTestId('idle-cleared')).toHaveCount(0);
});
