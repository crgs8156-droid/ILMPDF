import { expect, test, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePdf } from '../fixtures/make-pdf';

const ORIGIN = 'http://127.0.0.1:4173';

// Records every request the page tries to make, so tests can prove
// nothing ever goes anywhere except the local app server.
function trackRequests(page: import('@playwright/test').Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  return seen;
}

function offOrigin(requests: Request[]): string[] {
  return requests.map((r) => r.url()).filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('blob:'));
}

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

test('a PDF goes through the worker and saves byte-for-byte, with zero outside requests', async ({ page }) => {
  const requests = trackRequests(page);
  await page.goto('/');
  const pdf = makePdf(3);
  await page.getByTestId('file-input').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf),
  });
  const row = page.getByTestId('file-row');
  await expect(row).toHaveAttribute('data-status', 'ready');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save').click()]);
  expect(download.suggestedFilename()).toBe('sample-ilmpdf.pdf');
  const saved = await readFile((await download.path())!);
  expect(Buffer.compare(saved, Buffer.from(pdf))).toBe(0);

  expect(offOrigin(requests)).toEqual([]);
});

test('a fake PDF is rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<script>alert(1)</script>'),
  });
  await expect(page.getByTestId('file-row')).toHaveAttribute('data-status', 'rejected');
  await expect(page.getByTestId('save')).toHaveCount(0);
});

test('file names are shown as text, never as HTML', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: '<img src=x onerror=alert(1)>.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(makePdf()),
  });
  await expect(page.getByTestId('file-row')).toContainText('<img src=x onerror=alert(1)>.pdf');
  await expect(page.locator('img')).toHaveCount(0);
});
