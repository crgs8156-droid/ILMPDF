import { expect, test } from '@playwright/test';
import { addPdf, offOrigin, openTool, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

test('serves the strict security headers', async ({ page }) => {
  const response = await page.goto('/');
  const h = response!.headers();
  expect(h['content-security-policy']).toContain("connect-src 'none'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(h['cross-origin-embedder-policy']).toBe('require-corp');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-content-type-options']).toBe('nosniff');
});

// Safari refuses to start a worker whose revalidated (304) reply lacks COEP.
test('security headers are on 304 Not Modified replies too', async ({ request }) => {
  const first = await request.get('/');
  const etag = first.headers()['etag'];
  expect(etag).toBeTruthy();
  const again = await request.get('/', { headers: { 'If-None-Match': etag! } });
  expect(again.status()).toBe(304);
  expect(again.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(again.headers()['cross-origin-resource-policy']).toBe('same-origin');
  expect(again.headers()['content-security-policy']).toContain("connect-src 'none'");
});

// Each job gets a fresh worker; several jobs in a row must all work.
test('several jobs in a row each get a working worker', async ({ page }) => {
  await openTool(page, 'page-numbers');
  for (const name of ['one.pdf', 'two.pdf', 'three.pdf']) {
    await addPdf(page, name, makePdf(2));
    await expect(page.getByTestId('loaded-file')).toContainText(name);
    await page.getByRole('button', { name: 'Choose another file' }).click();
  }
});

test('page is cross-origin isolated and the network is blocked', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('network-status')).toHaveText('Network blocked');
  await expect(page.getByTestId('isolation-status')).toHaveText('Cross-origin isolated');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('CSP stops fetch to any outside host before it is sent', async ({ page }) => {
  const requests = trackRequests(page);
  await page.goto('/');
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/should-never-be-sent', { mode: 'no-cors' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  expect(offOrigin(requests)).toEqual([]);
});

test('a fake PDF is rejected before any engine sees it', async ({ page }) => {
  await openTool(page, 'merge');
  await addPdf(page, 'fake.pdf', new TextEncoder().encode('<script>alert(1)</script>'));
  await expect(page.getByTestId('notice-error')).toContainText('Not a real PDF');
});

test('file names are shown as text, never as HTML', async ({ page }) => {
  await openTool(page, 'merge');
  await addPdf(page, '<img src=x onerror=alert(1)>.pdf', makePdf());
  await expect(page.getByTestId('merge-row')).toContainText('<img src=x onerror=alert(1)>.pdf');
  await expect(page.locator('main img')).toHaveCount(0);
});

test('a password-protected PDF gets a clear message', async ({ page }) => {
  await openTool(page, 'split');
  await addPdf(page, 'locked.pdf', makePdf(2, { encrypted: true }));
  await expect(page.getByTestId('notice-error')).toContainText('password-protected');
});

test('a damaged PDF fails cleanly', async ({ page }) => {
  await openTool(page, 'organize');
  await addPdf(page, 'broken.pdf', makePdf(3, { truncate: true }));
  await expect(page.getByTestId('notice-error')).toContainText(/could not be read|damaged/);
});
