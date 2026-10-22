// Greyscale / invert, "image-based" mode. MuPDF draws each chosen page
// (with its comments and form fields) as a picture, already grey or
// inverted, and a new PDF is built from those pictures. Colour is then truly
// gone from those pages, but their text can no longer be selected or
// searched until OCR is run on the result. Runs in the MuPDF worker.
import type * as MuPDF from 'mupdf';
import { MAX_PAGES } from '../core/limits';
import { open } from './mupdf-ops';
import { UserFacingError } from './pdflib-ops';
import type { RecolorEffect } from './recolor';

type Mupdf = typeof MuPDF;

export type RasterDpi = 150 | 300;

export type RasterOptions = {
  effect: RecolorEffect;
  dpi: RasterDpi;
  /** 0-based pages to change; empty means every page. Other pages are copied unchanged. */
  pages: number[];
};

/**
 * Most pixels one page may become (about A3 at 300 dpi is 17 million). Bigger
 * pages, such as posters, get a lower resolution instead of exhausting memory.
 */
export const MAX_PAGE_PIXELS = 40_000_000;

export function recolorRaster(mupdf: Mupdf, bytes: Uint8Array, opts: RasterOptions): Uint8Array {
  if (opts.dpi !== 150 && opts.dpi !== 300) throw new UserFacingError('Choose 150 or 300 dpi.');
  const src = open(mupdf, bytes);
  const out = new mupdf.PDFDocument();
  try {
    if (src.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then convert it.');
    const count = src.countPages();
    if (count > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
    if (opts.pages.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) throw new UserFacingError('That page range is not in this PDF.');
    const chosen = new Set(opts.pages.length ? opts.pages : Array.from({ length: count }, (_, i) => i));
    // Greyscale pages only need one colour channel, a third of the memory.
    const space = opts.effect === 'greyscale' ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;

    for (let i = 0; i < count; i++) {
      if (!chosen.has(i)) {
        out.graftPage(-1, src, i);
        continue;
      }
      const page = src.loadPage(i);
      let pix: MuPDF.Pixmap | undefined;
      let image: MuPDF.Image | undefined;
      try {
        // Bounds are the page as shown: crop and rotation already applied.
        const [x0, y0, x1, y1] = page.getBounds();
        const w = x1 - x0;
        const h = y1 - y0;
        if (!(w > 0 && h > 0)) throw new UserFacingError(`Page ${i + 1} has no size, so it cannot be converted.`);
        const scale = Math.min(opts.dpi / 72, Math.sqrt(MAX_PAGE_PIXELS / (w * h)));
        // showExtras = true draws comments and form fields into the picture too.
        pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), space, false, true);
        if (opts.effect === 'invert') pix.invert();
        image = new mupdf.Image(pix);
        const resources = out.addObject({ XObject: { Im0: out.addImage(image) } });
        // The picture fills a page of the same size as the one shown, upright.
        const contents = `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im0 Do Q`;
        out.insertPage(-1, out.addPage([0, 0, w, h], 0, resources, contents));
      } finally {
        image?.destroy();
        pix?.destroy();
        page.destroy();
      }
    }
    // MuPDF stores the pictures losslessly (Flate), so text edges stay sharp.
    return new Uint8Array(out.saveToBuffer({ garbage: 'compact', compress: true }).asUint8Array());
  } finally {
    out.destroy();
    src.destroy();
  }
}

/** A number for a content stream: plain digits, never exponent notation. */
function num(n: number): string {
  return n.toFixed(4);
}
