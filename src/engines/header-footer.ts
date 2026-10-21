// Headers, footers and Bates numbers. Pure pdf-lib, run in the pdf-lib
// worker like the other edits. The text codes live in core/header-text.ts.
import { degrees, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { load, save, shownView, UserFacingError } from './pdflib-ops';
import { batesLabel, clamp, cleanText as clean, fillTemplate, MAX_AFFIX, MAX_TEXT, SLOTS, type BatesOptions, type PageValues, type Slot } from '../core/header-text';

export type HeaderFooterOptions = {
  /** Text for each spot on the page; empty or missing spots are skipped. */
  texts: Partial<Record<Slot, string>>;
  fontSize: number;
  /** Distance from the page edge, in points (72 points = 1 inch). */
  margin: number;
  /** 0-based pages to stamp; empty means every page. */
  pages: number[];
  /** Shown by {file}. Comes from the user's file name, so it is only ever drawn as text. */
  fileName: string;
  /** Shown by {date}. The UI passes the local date so the worker stays deterministic. */
  date: string;
  bates: BatesOptions;
};

/**
 * Stamps the chosen text in up to six spots on each page. Bates numbers count
 * up by one for each stamped page, so skipped pages do not use a number.
 */
export async function addHeaderFooter(bytes: Uint8Array, opts: HeaderFooterOptions): Promise<Uint8Array> {
  const texts = SLOTS.map((slot) => [slot, clean(opts.texts[slot] ?? '', MAX_TEXT)] as const).filter(([, t]) => t);
  if (texts.length === 0) throw new UserFacingError('Enter some text for at least one header or footer.');

  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Typed text must fit the built-in font; the file name just loses odd characters.
  for (const [, t] of texts) {
    if (!encodable(font, t)) {
      throw new UserFacingError('Header and footer text can only use basic Latin letters, digits and punctuation for now.');
    }
  }
  for (const affix of [opts.bates.prefix, opts.bates.suffix]) {
    if (!encodable(font, clean(affix, MAX_AFFIX))) {
      throw new UserFacingError('The Bates prefix and suffix can only use basic Latin letters, digits and punctuation.');
    }
  }
  const file = [...clean(opts.fileName, MAX_TEXT)].map((ch) => (encodable(font, ch) ? ch : '?')).join('');
  const date = clean(opts.date, 40);

  const size = clamp(opts.fontSize, 6, 48);
  const margin = clamp(opts.margin, 6, 144);
  const all = doc.getPages();
  const chosen = opts.pages.length ? opts.pages : all.map((_, i) => i);
  let bates = Math.trunc(clamp(opts.bates.start, 0, 1e12));

  for (const index of chosen) {
    const page = all[index];
    if (!page) throw new UserFacingError('A chosen page is out of range.');
    const values: PageValues = { page: index + 1, total: all.length, file, date, bates: batesLabel(opts.bates, bates) };
    for (const [slot, template] of texts) {
      drawInSlot(page, font, slot, fillTemplate(template, values), size, margin);
    }
    bates += 1;
  }
  return save(doc);
}

function drawInSlot(page: PDFPage, font: PDFFont, slot: Slot, text: string, size: number, margin: number) {
  if (!text) return;
  const view = shownView(page);
  const width = font.widthOfTextAtSize(text, size);
  // u runs right and v runs down from the top-left corner of the page as shown.
  const u = slot.endsWith('left') ? margin : slot.endsWith('right') ? view.shownW - margin - width : (view.shownW - width) / 2;
  // v is the text's baseline: one text height below the top margin, or on the bottom margin.
  const v = slot.startsWith('top') ? margin + size : view.shownH - margin;
  const [x, y] = view.toPage(u, v);
  // Turn the text with the page so it reads upright on screen.
  page.drawText(text, { x, y, size, font, color: rgb(0.15, 0.15, 0.15), rotate: degrees(view.turn) });
}

function encodable(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}
