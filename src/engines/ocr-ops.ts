// OCR (text recognition) for scanned PDFs. MuPDF draws each page as a
// picture, Tesseract (tesseract-wasm) reads the words in it, and
// ocr-layer.ts writes them back as an invisible, searchable text layer.
// Both engines are passed in, so this file runs in the OCR worker and
// directly under Node in unit tests, like mupdf-ops.ts.
import type * as MuPDF from 'mupdf';
import type { OCREngine } from 'tesseract-wasm';
import { open, checkPageLimit } from './mupdf-ops';
import { addTextLayer, type OcrPage } from './ocr-layer';
import { UserFacingError } from './pdflib-ops';

type Mupdf = typeof MuPDF;

export type OcrOptions = {
  /** 0-based pages to read; empty means every page. */
  pages: number[];
  /** Leave pages that already have text alone (on by default in the tool). */
  skipText: boolean;
};

export type OcrResult = { file: Uint8Array; read: number; skipped: number; words: number };

/** Called before each page: how many pages are done out of how many. */
export type OcrProgress = (done: number, total: number) => void;

// Tesseract reads best at about 300 dots per inch.
const DPI = 300;
// A cap on picture size, so a poster-sized page can't use gigabytes of memory.
const MAX_PIXELS = 40_000_000;
// Words Tesseract is less sure of than this are usually specks or smudges.
const MIN_CONFIDENCE = 0.3;

export async function ocr(
  mupdf: Mupdf,
  engine: OCREngine,
  bytes: Uint8Array,
  opts: OcrOptions,
  onProgress?: OcrProgress,
): Promise<OcrResult> {
  const pdf = open(mupdf, bytes);
  const found: OcrPage[] = [];
  let skipped = 0;
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then run OCR.');
    const count = pdf.countPages();
    checkPageLimit(count);
    const chosen = opts.pages.length ? opts.pages : Array.from({ length: count }, (_, i) => i);
    for (const [done, index] of chosen.entries()) {
      if (index < 0 || index >= count) throw new UserFacingError(`This PDF has no page ${index + 1}.`);
      onProgress?.(done, chosen.length);
      const page = pdf.loadPage(index);
      try {
        if (opts.skipText && hasText(page)) {
          skipped++;
          continue;
        }
        found.push({ page: index, words: readPage(mupdf, engine, page) });
      } finally {
        page.destroy();
      }
    }
    onProgress?.(chosen.length, chosen.length);
  } finally {
    pdf.destroy();
  }
  const { file, words } = await addTextLayer(bytes, found);
  return { file, read: found.length, skipped, words };
}

/** True when the page already has real (or earlier OCR) text on it. */
function hasText(page: MuPDF.PDFPage): boolean {
  const stext = page.toStructuredText('');
  try {
    return /\S/.test(stext.asText());
  } finally {
    stext.destroy();
  }
}

/** Draws one page as a picture and returns the words Tesseract finds in it. */
function readPage(mupdf: Mupdf, engine: OCREngine, page: MuPDF.PDFPage) {
  const [x0, y0, x1, y1] = page.getBounds();
  const [pw, ph] = [x1 - x0, y1 - y0];
  const scale = Math.min(DPI / 72, Math.sqrt(MAX_PIXELS / (pw * ph)));
  // getBounds() and toPixmap() both work on the page as shown (rotation
  // applied), so the picture is upright, as a person reads it.
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  try {
    const width = pix.getWidth();
    const height = pix.getHeight();
    engine.loadImage({ data: toRgba(pix), width, height } as ImageData);
    return engine
      .getTextBoxes('word')
      .filter((w) => w.confidence >= MIN_CONFIDENCE && w.text.trim())
      .map((w) => ({
        text: w.text,
        x: w.rect.left / width,
        y: w.rect.top / height,
        width: (w.rect.right - w.rect.left) / width,
        height: (w.rect.bottom - w.rect.top) / height,
      }));
  } finally {
    engine.clearImage();
    pix.destroy();
  }
}

/** MuPDF gives red-green-blue pixels; Tesseract wants red-green-blue-alpha. */
function toRgba(pix: MuPDF.Pixmap): Uint8ClampedArray {
  const [w, h, n, stride] = [pix.getWidth(), pix.getHeight(), pix.getNumberOfComponents(), pix.getStride()];
  const src = pix.getPixels();
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    let s = y * stride;
    let d = y * w * 4;
    for (let x = 0; x < w; x++, s += n, d += 4) {
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
      out[d + 3] = 255;
    }
  }
  return out;
}
