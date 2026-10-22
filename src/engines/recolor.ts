// Greyscale / invert, "keep text" mode. Pure pdf-lib, run in the pdf-lib
// worker. Nothing in the page is rewritten: one rectangle is drawn over each
// chosen page with a standard PDF blend mode, which every modern viewer
// (Safari, Preview, Chrome, Acrobat) applies to everything underneath:
//   - Saturation with a grey fill takes all colour away (greyscale);
//   - Difference with a white fill turns every colour into its opposite.
// Text stays selectable and the file barely grows, but the original colours
// are still stored under the filter. Comments and form fields are drawn
// above the page, so the filter does not reach them. The image-based mode
// (mupdf-recolor.ts) has neither limit.
import { fill, popGraphicsState, pushGraphicsState, rectangle, setFillingGrayscaleColor, setGraphicsState, type PDFOperator, type PDFPage } from 'pdf-lib';
import { load, save, UserFacingError } from './pdflib-ops';

export type RecolorEffect = 'greyscale' | 'invert';

export type OverlayOptions = {
  effect: RecolorEffect;
  /** 0-based pages to change; empty means every page. */
  pages: number[];
};

export async function recolorOverlay(bytes: Uint8Array, opts: OverlayOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const all = doc.getPages();
  const chosen = opts.pages.length ? opts.pages : all.map((_, i) => i);
  if (chosen.some((i) => !Number.isInteger(i) || i < 0 || i >= all.length)) throw new UserFacingError('That page range is not in this PDF.');

  // One shared graphics state for every page. pdf-lib's own blend-mode option
  // has no Saturation, so the dictionary is written directly.
  const ctx = doc.context;
  const state = ctx.register(ctx.obj({ Type: 'ExtGState', BM: opts.effect === 'greyscale' ? 'Saturation' : 'Difference', ca: 1, CA: 1 }));
  for (const i of new Set(chosen)) {
    const page = all[i]!;
    page.node.normalize();
    const name = page.node.newExtGState('ILMPDFRecolor', state);
    // The MediaBox holds every other page box, so covering it covers
    // whatever part is shown, whatever the rotation or crop.
    const { x, y, width, height } = page.getMediaBox();
    // One point extra on each side, so no half-covered pixel is left at the edge.
    const cover = (gray: number) => [setFillingGrayscaleColor(gray), rectangle(x - 1, y - 1, width + 2, height + 2), fill()];
    // White paper first: blending needs something solid underneath, and
    // viewers disagree on whether empty page areas count as white.
    const below = [pushGraphicsState(), ...cover(1), popGraphicsState()];
    const above = [pushGraphicsState(), setGraphicsState(name), ...cover(opts.effect === 'greyscale' ? 0.5 : 1), popGraphicsState()];
    wrapContent(page, below, above);
  }
  return save(doc);
}

/**
 * Draws `below` under the page's own drawing and `above` on top of it. The
 * page's drawing is wrapped in save/restore (q ... Q), so a position or scale
 * change it leaves behind cannot move the filter off the page.
 */
function wrapContent(page: PDFPage, below: PDFOperator[], above: PDFOperator[]): void {
  const ctx = page.doc.context;
  const start = ctx.register(ctx.contentStream([...below, pushGraphicsState()]));
  if (!page.node.wrapContentStreams(start, ctx.register(ctx.contentStream([popGraphicsState()])))) {
    // A page with no drawing of its own yet has nothing to wrap.
    page.node.addContentStream(start);
    page.node.addContentStream(ctx.register(ctx.contentStream([popGraphicsState()])));
  }
  page.node.addContentStream(ctx.register(ctx.contentStream(above)));
}
