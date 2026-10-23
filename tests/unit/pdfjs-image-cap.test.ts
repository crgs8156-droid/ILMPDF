// PDF.js must leave out pictures bigger than MAX_RENDER_IMAGE_PIXELS, so a
// hostile PDF claiming a gigantic picture can't freeze the page while the
// preview is drawn (it froze Safari's page in Organize), while normal
// pictures still show.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { MAX_RENDER_IMAGE_PIXELS } from '../../src/core/limits';
import { hostilePdfs } from '../fixtures/hostile-pdfs';
import { TINY_PNG } from '../fixtures/make-pdf';

/** Counts the pictures PDF.js would draw on page 1, with the app's cap. */
async function picturesDrawn(bytes: Uint8Array): Promise<number> {
  const task = getDocument({ data: bytes.slice(), maxImageSize: MAX_RENDER_IMAGE_PIXELS, verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(1);
    const ops = await page.getOperatorList();
    return ops.fnArray.filter((op) => op === OPS.paintImageXObject).length;
  } finally {
    await task.destroy();
  }
}

describe('PDF.js picture size cap', () => {
  it('leaves out a picture that claims 100,000 x 100,000 pixels', async () => {
    const huge = (await hostilePdfs()).find((f) => f.name === 'huge-image-claim')!;
    expect(await picturesDrawn(huge.bytes)).toBe(0);
  });

  it('still draws a normal picture', async () => {
    const doc = await PDFDocument.create();
    const png = await doc.embedPng(TINY_PNG);
    doc.addPage([200, 200]).drawImage(png, { x: 0, y: 0, width: 100, height: 100 });
    expect(await picturesDrawn(await doc.save())).toBe(1);
  });

  it('is the cap the app gives PDF.js', () => {
    const source = readFileSync(new URL('../../src/engines/pdfjs.ts', import.meta.url), 'utf8');
    expect(source).toContain('maxImageSize: MAX_RENDER_IMAGE_PIXELS');
  });
});
