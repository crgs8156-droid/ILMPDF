// Writes the words found by OCR into a PDF as invisible text, the way
// OCRmyPDF and scanner apps make "searchable PDFs": the page still shows the
// original scan, and an invisible copy of each word sits exactly over its
// picture, so search, select and copy work. Pure pdf-lib over bytes, so it
// runs in the OCR worker and directly under Node in unit tests.
import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  StandardFonts,
  TextRenderingMode,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import { load, save, shownView } from './pdflib-ops';

/**
 * One recognised word. The box is in fractions (0 to 1) of the page as it is
 * shown on screen, from its top-left corner, like every other on-page
 * position in ILMPDF.
 */
export type OcrWord = { text: string; x: number; y: number; width: number; height: number };

/** The words of one page (0-based page index). */
export type OcrPage = { page: number; words: OcrWord[] };

// Helvetica's descender is about a fifth of the font size: the baseline sits
// that far above the bottom of a word's box.
const DESCENT = 0.2;

/**
 * Keeps only the characters the built-in Helvetica font can write
 * (Western European letters, digits and punctuation). Anything else is
 * dropped from the invisible layer rather than written wrongly.
 */
function writable(text: string, charset: Set<number>): string {
  let out = '';
  for (const ch of text) if (charset.has(ch.codePointAt(0)!)) out += ch;
  return out.trim();
}

/** Adds an invisible text layer to the listed pages. Returns the new file and how many words were written. */
export async function addTextLayer(bytes: Uint8Array, pages: OcrPage[]): Promise<{ file: Uint8Array; words: number }> {
  const doc = await load(bytes);
  const all = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  let words = 0;
  for (const { page: index, words: found } of pages) {
    const page = all[index];
    if (!page) continue;
    const ops = wordOperators(page, font, found, charset);
    if (ops.length === 0) continue;
    words += ops.length;
    appendContent(page, [
      pushGraphicsState(),
      beginText(),
      setFontAndSize(page.node.newFontDictionary('OCR', font.ref), 1),
      setTextRenderingMode(TextRenderingMode.Invisible),
      ...ops.flat(),
      endText(),
      popGraphicsState(),
    ]);
  }
  return { file: await save(doc), words };
}

/** The drawing commands for each word (one inner list per word written). */
function wordOperators(page: PDFPage, font: PDFFont, found: OcrWord[], charset: Set<number>): PDFOperator[][] {
  const view = shownView(page);
  // Text runs to the right and "up" on screen. In page coordinates, which do
  // not rotate with the page, those directions turn with the page's rotation.
  const rad = (view.turn * Math.PI) / 180;
  const [cos, sin] = [Math.round(Math.cos(rad)), Math.round(Math.sin(rad))];
  const out: PDFOperator[][] = [];
  for (const word of found) {
    const text = writable(word.text, charset);
    if (!text) continue;
    const w = word.width * view.shownW;
    const h = word.height * view.shownH;
    if (!(w > 0 && h > 0)) continue;
    const size = h;
    // Stretch or squeeze the word so it covers exactly its picture.
    const natural = font.widthOfTextAtSize(text, size);
    const squeeze = Math.min(1000, Math.max(1, (100 * w) / natural));
    const [px, py] = view.toPage(word.x * view.shownW, (word.y + word.height) * view.shownH - DESCENT * h);
    // The font is set at size 1, so the text matrix carries the size too.
    out.push([
      setTextMatrix(cos * size, sin * size, -sin * size, cos * size, px, py),
      setCharacterSqueeze(squeeze),
      showText(font.encodeText(text)),
    ]);
  }
  return out;
}

/**
 * Appends a content stream to the page. The page's own drawing is first
 * wrapped in save/restore (q ... Q), so any position or scale change it
 * leaves behind cannot shift the invisible words away from their pictures.
 */
function appendContent(page: PDFPage, ops: PDFOperator[]): void {
  const ctx = page.doc.context;
  page.node.normalize();
  page.node.wrapContentStreams(ctx.register(ctx.contentStream([pushGraphicsState()])), ctx.register(ctx.contentStream([popGraphicsState()])));
  page.node.addContentStream(ctx.register(ctx.contentStream(ops)));
}
