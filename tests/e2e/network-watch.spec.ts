// Proves the network watcher in fixtures.ts really catches problems. Each
// test here does something forbidden on purpose and is marked test.fail():
// it only counts as passing if the watcher fails it. Nothing is sent to
// the internet: the outside address is answered locally by page.route.
import { expect, test } from './fixtures';

test('the watcher fails a test whose page tries an outside fetch', async ({ page }) => {
  test.fail();
  await page.goto('/');
  await page.evaluate(() => fetch('https://example.invalid/leak', { mode: 'no-cors' }).catch(() => undefined));
});

test('the watcher fails a test whose page sends an outside request', async ({ page }) => {
  test.fail();
  await page.route('https://example.invalid/**', (route) => route.fulfill({ body: 'local stand-in' }));
  await page.goto('https://example.invalid/page');
  await expect(page.locator('body')).toContainText('local stand-in');
});

test('the watcher passes a normal page load (only the expected self-check)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('network-status')).toHaveText('Network blocked');
});
