// Finds blank pages. PDF.js draws each page small, onto a white canvas, and
// we count the "ink": pixels clearly darker than paper. The PDF itself is
// parsed in PDF.js's own worker; only drawing and counting happen here.
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type Sensitivity = 'strict' | 'normal' | 'scans';

/**
 * How much ink a page may have and still count as blank, as a share of its
 * pixels, and how much of each edge to ignore (scans often have dark edges
 * or punch holes there).
 */
export const SENSITIVITY: Record<Sensitivity, { maxInk: number; edge: number }> = {
  strict: { maxInk: 0, edge: 0 }, // nothing at all on the page
  normal: { maxInk: 0.0002, edge: 0 }, // a few stray marks
  scans: { maxInk: 0.003, edge: 0.04 }, // paper texture, specks, dark edges
};

// A pixel this dark (0 = black, 255 = white) or darker counts as ink.
// Very light marks, such as paper tint in scans, do not.
const INK_LEVEL = 225;
// Pages are drawn this many pixels on their longer side: enough to see a
// line of small text, small enough to check hundreds of pages quickly.
const RENDER_SIZE = 240;

/** Share of pixels (0 to 1) that are ink, ignoring `edge` (a fraction) of each side. */
export function inkFraction(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, edge = 0): number {
  const x0 = Math.floor(width * edge);
  const y0 = Math.floor(height * edge);
  const x1 = width - x0;
  const y1 = height - y0;
  let ink = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      // Rec. 601 brightness; coloured marks count by how dark they look.
      const level = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
      if (level <= INK_LEVEL) ink++;
    }
  }
  const area = (x1 - x0) * (y1 - y0);
  return area > 0 ? ink / area : 0;
}

/**
 * Returns the 0-based indices of pages that look blank. `onProgress` is
 * called with the number of pages checked so far.
 */
export async function findBlankPages(
  doc: PDFDocumentProxy,
  sensitivity: Sensitivity,
  onProgress: (checked: number) => void = () => {},
): Promise<number[]> {
  const { maxInk, edge } = SENSITIVITY[sensitivity];
  const blank: number[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot check pages for content.');
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: RENDER_SIZE / Math.max(base.width, base.height) });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (inkFraction(data, canvas.width, canvas.height, edge) <= maxInk) blank.push(n - 1);
      } finally {
        page.cleanup();
      }
      onProgress(n);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  return blank;
}
