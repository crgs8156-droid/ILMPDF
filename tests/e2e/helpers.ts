import { expect, type Download, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export const ORIGIN = 'http://127.0.0.1:4173';

/** Records every request so tests can prove nothing leaves the local server. */
export function trackRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  return seen;
}

export function offOrigin(requests: Request[]): string[] {
  return requests
    .map((r) => r.url())
    .filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:'));
}

export async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(`/#/${id}`);
  await expect(page.getByTestId(`tool-${id}`)).toBeVisible();
}

export async function addPdf(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
}

/** Clicks and collects every download the click triggers. */
export async function collectDownloads(page: Page, click: () => Promise<void>, expected: number): Promise<Download[]> {
  const downloads: Download[] = [];
  const onDownload = (d: Download) => downloads.push(d);
  page.on('download', onDownload);
  await click();
  await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(expected);
  page.off('download', onDownload);
  return downloads;
}

export async function bytesOf(download: Download): Promise<Uint8Array> {
  return new Uint8Array(await readFile((await download.path())!));
}
