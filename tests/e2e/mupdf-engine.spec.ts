import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { offOrigin, trackRequests } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

// Starts the built MuPDF worker directly, under the real CSP, and checks that
// it loads its WebAssembly from the bundle without any network request.
// (Looked up lazily: dist/ is built by the web server after tests are collected.)
const workerFile = () => readdirSync('dist/assets').find((f) => /^mupdf\.worker-.*\.js$/.test(f));

async function inspect(page: import('@playwright/test').Page, bytes: Uint8Array) {
  return page.evaluate(
    async ({ url, data }) => {
      const worker = new Worker(url, { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = (e) => resolve(e.data);
          worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
          worker.postMessage({ id: 'x', job: { op: 'inspect', file: new Uint8Array(data) } });
        });
      } finally {
        worker.terminate();
      }
    },
    { url: `/assets/${workerFile()}`, data: [...bytes] },
  );
}

test('MuPDF loads offline and reads a PDF', async ({ page }) => {
  test.slow();
  expect(workerFile(), 'built MuPDF worker').toBeTruthy();
  const requests = trackRequests(page);
  const cspErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && !m.text().includes('__ilmpdf_network_probe')) {
      cspErrors.push(m.text());
    }
  });
  await page.goto('/');
  expect(await inspect(page, makePdf(4))).toEqual({ id: 'x', ok: true, info: { pages: 4, encrypted: false, needsPassword: false } });
  expect(await inspect(page, makePdf(3, { truncate: true }))).toMatchObject({ ok: false });
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const locked = files.find((f) => f.name === '10-password-is-test.pdf')!.bytes;
  expect(await inspect(page, locked)).toMatchObject({ ok: true, info: { encrypted: true, needsPassword: true } });
  expect(offOrigin(requests)).toEqual([]);
  expect(requests.filter((r) => r.url().endsWith('.wasm')).map((r) => r.url())).toEqual([]);
  expect(cspErrors).toEqual([]);
});
