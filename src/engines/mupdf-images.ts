// Extract images: saves the pictures stored inside a PDF (not screenshots of
// its pages). Runs inside the MuPDF worker on untrusted PDFs.
//
// How images are found: each chosen page's resources list the pictures
// ("Image XObjects") it draws, plus "Form XObjects" (reusable groups, such as
// a placed page) that have resources of their own, which are searched too.
// Pictures written straight into the page's drawing code ("inline images")
// are tiny by design and are not included.
import type * as MuPDF from 'mupdf';
import { MAX_IMAGES, MAX_PAGES } from '../core/limits';
import { open } from './mupdf-ops';
import { UserFacingError } from './pdflib-ops';

type Mupdf = typeof MuPDF;

export type ImageOptions = {
  /** 0-based page numbers to search, in order. */
  pages: number[];
  /** Leave out pictures smaller than 32 x 32 pixels (icons, specks). */
  skipTiny: boolean;
};

/** One saved picture; `index` counts from 1 on its page. */
export type ExtractedImage = { page: number; index: number; ext: 'jpg' | 'png'; width: number; height: number };

export type ImageReport = {
  images: ExtractedImage[];
  /** Same order as `images`. */
  files: Uint8Array[];
  tiny: number;
  /** Pictures already saved from an earlier page. */
  repeats: number;
  /** Pictures that were too big, damaged or of an unsupported kind. */
  failed: number;
  /** True when the image limit stopped the search early. */
  truncated: boolean;
};

const TINY_PIXELS = 32 * 32;
const MAX_PIXELS = 60_000_000; // above this, decoding could run out of memory
const MAX_OUTPUT_BYTES = 400 * 1024 * 1024; // keeps the result well inside Safari's memory limit
const MAX_DEPTH = 10; // nested groups deeper than this are almost certainly a trap

export function extractImages(mupdf: Mupdf, bytes: Uint8Array, opts: ImageOptions): ImageReport {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF is password-protected. Unlock it first, then extract its images.');
    const count = pdf.countPages();
    if (count > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);

    const report: ImageReport = { images: [], files: [], tiny: 0, repeats: 0, failed: 0, truncated: false };
    const seen = new Set<number>();
    let total = 0;
    for (const p of opts.pages) {
      if (!(p >= 0 && p < count)) continue;
      const page = pdf.loadPage(p);
      try {
        const found: MuPDF.PDFObject[] = [];
        collect(page.getObject().getInheritable('Resources'), found, new Set(), 0);
        let index = 0;
        for (const obj of found) {
          const num = obj.isIndirect() ? obj.asIndirect() : -1;
          if (num > 0 && seen.has(num)) {
            report.repeats++;
            continue;
          }
          if (num > 0) seen.add(num);
          const w = Number(obj.get('Width').valueOf());
          const h = Number(obj.get('Height').valueOf());
          if (!(w > 0 && h > 0) || w * h > MAX_PIXELS) {
            report.failed++;
            continue;
          }
          if (opts.skipTiny && w * h < TINY_PIXELS) {
            report.tiny++;
            continue;
          }
          if (report.images.length >= MAX_IMAGES || total >= MAX_OUTPUT_BYTES) {
            report.truncated = true;
            return report;
          }
          const saved = save(mupdf, pdf, obj);
          if (!saved) {
            report.failed++;
            continue;
          }
          index++;
          total += saved.bytes.length;
          report.images.push({ page: p, index, ext: saved.ext, width: saved.width, height: saved.height });
          report.files.push(saved.bytes);
        }
      } finally {
        page.destroy();
      }
    }
    return report;
  } finally {
    pdf.destroy();
  }
}

/** Adds the pictures in a resource dictionary, then searches its groups. */
function collect(resources: MuPDF.PDFObject, out: MuPDF.PDFObject[], visited: Set<number>, depth: number) {
  if (depth > MAX_DEPTH || !resources.isDictionary()) return;
  const xobjects = resources.get('XObject');
  if (!xobjects.isDictionary()) return;
  xobjects.forEach((value) => {
    if (!value.isStream()) return;
    // A group can (maliciously) contain itself; visit each object once.
    if (value.isIndirect()) {
      if (visited.has(value.asIndirect())) return;
      visited.add(value.asIndirect());
    }
    const subtype = value.get('Subtype').toString();
    if (subtype === '/Image') {
      // Stencil masks are shapes painted in one colour, not pictures.
      if (value.get('ImageMask').valueOf() !== true) out.push(value);
    } else if (subtype === '/Form') {
      collect(value.get('Resources'), out, visited, depth + 1);
    }
  });
}

type Saved = { bytes: Uint8Array; ext: 'jpg' | 'png'; width: number; height: number };

function save(mupdf: Mupdf, pdf: MuPDF.PDFDocument, obj: MuPDF.PDFObject): Saved | null {
  try {
    const original = asOriginalJpeg(obj);
    if (original) {
      return { bytes: original, ext: 'jpg', width: Number(obj.get('Width').valueOf()), height: Number(obj.get('Height').valueOf()) };
    }
    return asPng(mupdf, pdf, obj);
  } catch {
    // A damaged or unsupported picture is counted, never fatal.
    return null;
  }
}

/**
 * A plain JPEG (DCT) picture in RGB or gray, with no transparency or colour
 * tweaks, is already a complete .jpg file: copy its bytes unchanged, so there
 * is no quality loss. Everything else is decoded and saved as PNG.
 */
function asOriginalJpeg(obj: MuPDF.PDFObject): Uint8Array | null {
  const filter = obj.get('Filter');
  const only = filter.isArray() ? (filter.length === 1 ? filter.get(0) : null) : filter;
  if (!only || only.toString() !== '/DCTDecode') return null;
  if (!obj.get('SMask').isNull() || !obj.get('Mask').isNull() || !obj.get('Decode').isNull()) return null;
  if (!['/DeviceRGB', '/DeviceGray'].includes(colorSpaceName(obj.get('ColorSpace')))) return null;
  const bytes = new Uint8Array(obj.readRawStream().asUint8Array());
  // Check the JPEG start marker, so a mislabelled stream isn't saved as .jpg.
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
}

/** DeviceRGB / DeviceGray, also when given as an ICC profile with 3 or 1 colours. */
function colorSpaceName(cs: MuPDF.PDFObject): string {
  if (cs.isName()) return cs.toString();
  if (cs.isArray() && cs.get(0).toString() === '/ICCBased') {
    const n = Number(cs.get(1).get('N').valueOf());
    return n === 3 ? '/DeviceRGB' : n === 1 ? '/DeviceGray' : '';
  }
  return '';
}

/**
 * Decodes the picture, converts it to RGB (or gray) and saves a PNG. A soft
 * mask (transparency) is a separate picture in the PDF, which MuPDF does not
 * apply when drawing the picture on its own, so it is drawn separately and
 * combined into the PNG's alpha channel.
 */
function asPng(mupdf: Mupdf, pdf: MuPDF.PDFDocument, obj: MuPDF.PDFObject): Saved {
  // Pixel data lives in WebAssembly memory, so free each piece when done.
  const owned: { destroy(): void }[] = [];
  const keep = <T extends { destroy(): void }>(x: T): T => (owned.push(x), x);
  try {
    const image = keep(pdf.loadImage(obj));
    const w = image.getWidth();
    const h = image.getHeight();
    const gray = image.getNumberOfComponents() === 1;
    const space = gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
    // Drawing (rather than reading raw pixels) applies the picture's colour
    // space, Decode array and palette exactly as a PDF viewer would.
    const draw = (img: MuPDF.Image, cs: MuPDF.ColorSpace, background: number) => {
      const canvas = keep(new mupdf.Pixmap(cs, [0, 0, w, h], false));
      canvas.clear(background);
      const device = keep(new mupdf.DrawDevice(mupdf.Matrix.identity, canvas));
      // Images fill a 1 x 1 unit square; this matrix stretches it to w x h
      // pixels (one pixel per image pixel).
      device.fillImage(img, [w, 0, 0, h, 0, 0], 1);
      device.close();
      return canvas;
    };
    const colour = draw(image, space, 255);
    const maskImage = image.getMask();
    if (!maskImage) return { bytes: new Uint8Array(colour.asPNG()), ext: 'png', width: w, height: h };

    keep(maskImage);
    // A mask decodes to one channel with no colour space, which MuPDF won't
    // draw directly. Copy it into a gray picture first; drawing that at
    // w x h also scales a mask whose size differs from the picture's.
    const raw = keep(maskImage.toPixmap());
    if (raw.getNumberOfComponents() !== 1) throw new Error('unexpected mask');
    const maskGray = keep(new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, raw.getWidth(), raw.getHeight()], false));
    maskGray.getPixels().set(raw.getPixels());
    const alpha = draw(keep(new mupdf.Image(maskGray)), mupdf.ColorSpace.DeviceGray, 0).getPixels();
    const out = keep(new mupdf.Pixmap(space, [0, 0, w, h], true));
    const src = colour.getPixels();
    const dst = out.getPixels();
    const n = gray ? 1 : 3;
    // MuPDF stores colour already multiplied by alpha ("premultiplied") and
    // undoes that when writing the PNG, so multiply here.
    for (let i = 0, s = 0, d = 0; i < w * h; i++) {
      const a = alpha[i]!;
      for (let c = 0; c < n; c++) dst[d++] = Math.round((src[s++]! * a) / 255);
      dst[d++] = a;
    }
    return { bytes: new Uint8Array(out.asPNG()), ext: 'png', width: w, height: h };
  } finally {
    for (const x of owned.reverse()) x.destroy();
  }
}
