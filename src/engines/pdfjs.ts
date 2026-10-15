// PDF.js (Mozilla) renders page thumbnails and page images.
// Parsing runs inside PDF.js's own Web Worker; only drawing happens here.
//
// PDF.js normally downloads fonts, character maps and WASM decoders at run
// time. ILMPDF's CSP forbids every network request (connect-src 'none'), so
// those files are bundled into the app and handed to PDF.js from memory.
// The "legacy" build is the same PDF.js with polyfills for newer JavaScript
// features (such as Map.getOrInsertComputed) that Safari and Chrome may lack.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

type Loader = () => Promise<string>;
const glob = (g: Record<string, unknown>) => g as Record<string, Loader>;

// Each file becomes its own lazily loaded chunk; nothing loads until needed.
const BUNDLED: Record<string, Record<string, Loader>> = {
  standardFontDataUrl: glob(
    import.meta.glob('../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?b64', import: 'default' }),
  ),
  cMapUrl: glob(import.meta.glob('../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?b64', import: 'default' })),
  // Image decoders (JPEG 2000, JBIG2) and colour management. The QuickJS
  // engine PDF.js ships for running scripts inside PDFs is deliberately left out.
  wasmUrl: glob(
    import.meta.glob('../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', {
      query: '?b64',
      import: 'default',
    }),
  ),
};
const DIRS: Record<string, string> = { standardFontDataUrl: 'standard_fonts', cMapUrl: 'cmaps', wasmUrl: 'wasm' };

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Same interface as PDF.js's built-in factory, but reads from the bundle.
class BundledDataFactory {
  constructor(_opts: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const dir = DIRS[kind];
    const load = dir ? BUNDLED[kind]?.[`../../node_modules/pdfjs-dist/${dir}/${filename}`] : undefined;
    if (!load) throw new Error(`ILMPDF: no bundled ${kind} file "${filename}"`);
    return base64ToBytes(await load());
  }
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = getDocument({
    data: bytes.slice(), // PDF.js takes ownership of what it is given
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
    // Non-empty placeholders tell PDF.js these resources exist; the factory
    // above serves them, so no URL is ever requested.
    cMapUrl: 'bundled:/',
    cMapPacked: true,
    standardFontDataUrl: 'bundled:/',
    wasmUrl: 'bundled:/',
    enableXfa: false,
    useSystemFonts: false,
    stopAtErrors: false,
  } as Parameters<typeof getDocument>[0]);
  try {
    return await task.promise;
  } catch (err) {
    await task.destroy();
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password with the Unlock tool first.');
    throw new Error('This file could not be read as a PDF. It may be damaged.');
  }
}

/** Renders one page (1-based) into the given canvas at the requested CSS width. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  rotation = 0,
): Promise<void> {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr, rotation: (page.rotate + rotation) % 360 });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport }).promise;
  } finally {
    page.cleanup();
  }
}

/** Renders a page to an image file at the given resolution (dots per inch). */
export async function pageToImage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  format: 'image/png' | 'image/jpeg',
  dpi: number,
): Promise<Blob> {
  const page = await doc.getPage(pageNumber);
  try {
    let scale = dpi / 72;
    const base = page.getViewport({ scale: 1 });
    // Keep each image under ~40 megapixels so Safari never runs out of canvas memory.
    const maxScale = Math.sqrt(40_000_000 / (base.width * base.height));
    scale = Math.min(scale, maxScale);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    if (format === 'image/jpeg') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    await page.render({ canvas, viewport, background: format === 'image/jpeg' ? '#ffffff' : 'rgba(0,0,0,0)' }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, format, 0.92));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('Could not create the image.');
    return blob;
  } finally {
    page.cleanup();
  }
}

/** Frees the document and stops its PDF.js worker. */
export async function closePdf(doc: PDFDocumentProxy | null | undefined): Promise<void> {
  if (doc) await doc.loadingTask.destroy();
}
