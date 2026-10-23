// Hostile synthetic PDFs through the real app: real Web Workers, PDF.js
// previews, the orchestrator's time limit and the network watcher. Each
// file must end in a clear result (an error message, a saved file or a
// notice) within a time limit, no script inside a PDF may run, the page must
// stay responsive, and a normal job must still work afterwards.
// The full engine-level fuzzing is in tests/fuzz/fuzz.test.ts.
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { addPdf, openTool } from './helpers';
import { makePdf } from '../fixtures/make-pdf';
import { hostilePdfs, type HostileFile } from '../fixtures/hostile-pdfs';

// The tricks most likely to hurt a browser: loops, bombs, deep nesting,
// huge claims, broken fonts and images, and scripts.
const PICK = [
  'flate-bomb-content', 'flate-bomb-image', 'deep-nesting', 'page-tree-loop', 'outline-loop',
  'xref-prev-loop', 'huge-image-claim', 'form-xobject-loop', 'broken-font', 'broken-jbig2',
  'active-content', 'hostile-text', 'many-real-pages',
];
// Organize: pdf-lib + PDF.js thumbnails. PDF to images: PDF.js rendering.
// Compress: MuPDF.
const TOOLS = ['organize', 'pdf-to-images', 'compress'] as const;

let files: HostileFile[];
test.beforeAll(async () => {
  files = (await hostilePdfs()).filter((f) => PICK.includes(f.name));
  expect(files.map((f) => f.name).sort()).toEqual([...PICK].sort());
});

/** Opens the tool from the home page, so no earlier file is still loaded in it. */
async function fresh(page: Page, tool: string): Promise<void> {
  await page.goto('/');
  await openTool(page, tool);
}

/** Waits until the tool shows the file or an error; then runs it if it can, and waits for a result. */
async function tryTool(page: Page, tool: (typeof TOOLS)[number], file: HostileFile): Promise<void> {
  await fresh(page, tool);
  await addPdf(page, `${file.name}.pdf`, file.bytes);
  const error = page.getByTestId('notice-error');
  await expect(error.or(page.getByTestId('loaded-file')).first(), `${tool}: ${file.why}`).toBeVisible({ timeout: 30_000 });
  if (await error.isVisible()) return;
  const run = page.getByTestId('run');
  if (tool === 'pdf-to-images') await page.getByTestId('img-pages').fill('1');
  if (!(await run.isEnabled())) return;
  const download = page.waitForEvent('download', { timeout: 90_000 }).then(() => 'download');
  const notice = expect(error.or(page.getByTestId('notice-ok')).first())
    .toBeVisible({ timeout: 90_000 })
    .then(() => 'notice');
  await run.click();
  const outcome = await Promise.race([download, notice]);
  expect(outcome, `${tool}: ${file.why}`).toBeTruthy();
  download.catch(() => undefined);
  notice.catch(() => undefined);
}

for (const tool of TOOLS) {
  test(`${tool}: hostile files fail cleanly and the next job still works`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });

    for (const file of files) {
      await tryTool(page, tool, file);
      // Still responsive: the page answers right away.
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
    }
    expect(dialogs, 'no script inside a PDF may run').toEqual([]);

    // A normal file still works after all of that.
    await fresh(page, tool);
    await addPdf(page, 'normal.pdf', makePdf(2));
    await expect(page.getByTestId('loaded-file')).toBeVisible();
    await expect(page.getByTestId('notice-error')).toHaveCount(0);
  });
}
