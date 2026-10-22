// Page tools: resize pages and insert pages. Pure pdf-lib functions over
// bytes, like pdflib-ops, so they run in the pdf-lib worker and under Node
// in unit tests. (Removing blank pages is done by removePages() in
// mupdf-pages.ts; finding them is done with PDF.js in engines/blank-pages.ts.)
import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFDocument, type PDFPage } from 'pdf-lib';
import { MAX_PAGES } from '../core/limits';
import { load, UserFacingError } from './pdflib-ops';

/** Paper sizes in PDF points (1/72 inch), portrait. */
export const PAPER = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
} as const;
export type Paper = keyof typeof PAPER;

export const MM = 72 / 25.4;

export type ResizeOptions = {
  /** Target width and height in points, as the page is shown (after rotation). */
  width: number;
  height: number;
  /** 'auto' turns the target to match each page's own orientation. */
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Empty space kept around the content, in points. */
  margin: number;
  /** 0-based pages to resize; empty means every page. */
  pages: number[];
};

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

/**
 * Changes the paper size of pages. Each page's visible content is scaled to
 * fit the new size (keeping its shape) and centred.
 *
 * The page itself is kept, not redrawn: its content is wrapped in a scale and
 * move instruction, and links, comments and form fields are moved to match.
 * So text stays selectable and fields stay fillable. Anything that was
 * hidden outside the old crop area stays hidden (it is clipped off).
 */
export async function resizePages(bytes: Uint8Array, opts: ResizeOptions): Promise<Uint8Array> {
  // PDF pages can be at most 200 inches (14,400 points) on a side.
  const width = clamp(opts.width, 72, 14400);
  const height = clamp(opts.height, 72, 14400);
  const margin = clamp(opts.margin, 0, Math.min(width, height) / 3);
  const doc = await load(bytes);
  const all = doc.getPages();
  const chosen = opts.pages.length ? opts.pages : all.map((_, i) => i);
  // A damaged file can list one annotation on two pages; move it only once.
  const moved = new Set<PDFDict>();
  for (const index of new Set(chosen)) {
    const page = all[index];
    if (!page) throw new UserFacingError(`This PDF has no page ${index + 1}.`);
    resizeOne(doc, page, { width, height, orientation: opts.orientation, margin }, moved);
  }
  return save(doc);
}

type Target = { width: number; height: number; orientation: ResizeOptions['orientation']; margin: number };

function resizeOne(doc: PDFDocument, page: PDFPage, target: Target, moved: Set<PDFDict>) {
  const { width: w, height: h, orientation, margin } = target;
  const box = page.getCropBox();
  const turn = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const sideways = turn === 90 || turn === 270;
  // Work out the target as the reader sees the page...
  const shownLandscape = sideways ? box.height > box.width : box.width > box.height;
  const landscape = orientation === 'auto' ? shownLandscape : orientation === 'landscape';
  const [shownW, shownH] = landscape === w > h ? [w, h] : [h, w];
  // ...then in the page's own (unrotated) space, where the content lives.
  // The page keeps its rotation, so a scale and a move are all that's needed.
  const [newW, newH] = sideways ? [shownH, shownW] : [shownW, shownH];
  const scale = Math.min((newW - 2 * margin) / box.width, (newH - 2 * margin) / box.height);
  const dx = (newW - box.width * scale) / 2 - box.x * scale;
  const dy = (newH - box.height * scale) / 2 - box.y * scale;

  const n = (v: number) => +v.toFixed(4);
  // "q ... cm" scales and moves everything that follows; the "re W n" clip
  // keeps content from outside the old crop area out of the new margins.
  // "Q" at the end restores the state so the wrap stays self-contained.
  const start = `q ${n(scale)} 0 0 ${n(scale)} ${n(dx)} ${n(dy)} cm ${n(box.x)} ${n(box.y)} ${n(box.width)} ${n(box.height)} re W n\n`;
  wrapContents(doc, page, start, '\nQ\n');
  moveAnnotations(doc, page, (x, y) => [x * scale + dx, y * scale + dy], scale, moved);

  page.setMediaBox(0, 0, newW, newH);
  for (const key of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) page.node.delete(PDFName.of(key));
}

/**
 * Puts new content before and after a page's existing content. A new
 * /Contents array is built so that a content array shared with other pages
 * is never changed.
 */
function wrapContents(doc: PDFDocument, page: PDFPage, before: string, after: string) {
  const key = PDFName.of('Contents');
  const current = page.node.get(key);
  if (!current) return; // an empty page has nothing to scale
  const existing = doc.context.lookup(current);
  const parts = existing instanceof PDFArray ? existing.asArray() : [current];
  const pre = doc.context.register(doc.context.flateStream(before));
  const post = doc.context.register(doc.context.flateStream(after));
  page.node.set(key, doc.context.obj([pre, ...parts, post]));
}

type Mapper = (x: number, y: number) => [number, number];

/** Moves every annotation (links, comments, form fields) the same way as the content. */
function moveAnnotations(doc: PDFDocument, page: PDFPage, map: Mapper, scale: number, moved: Set<PDFDict>) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookupMaybe(i, PDFDict);
    if (!dict || moved.has(dict)) continue;
    moved.add(dict);
    // Points stored as flat x, y, x, y ... lists.
    mapNumbers(dict, 'Rect', map);
    mapNumbers(dict, 'QuadPoints', map);
    mapNumbers(dict, 'L', map);
    mapNumbers(dict, 'Vertices', map);
    mapNumbers(dict, 'CL', map);
    const ink = dict.lookupMaybe(PDFName.of('InkList'), PDFArray);
    if (ink) {
      for (let s = 0; s < ink.size(); s++) {
        const stroke = ink.lookupMaybe(s, PDFArray);
        if (stroke) mapArray(stroke, map);
      }
    }
    // /RD is an inset from the edges, so it only scales.
    const rd = dict.lookupMaybe(PDFName.of('RD'), PDFArray);
    if (rd) {
      const nums = numbersOf(rd);
      if (nums) dict.set(PDFName.of('RD'), doc.context.obj(nums.map((v) => v * scale)));
    }
  }
}

function mapNumbers(dict: PDFDict, key: string, map: Mapper) {
  const arr = dict.lookupMaybe(PDFName.of(key), PDFArray);
  if (arr) mapArray(arr, map);
}

function numbersOf(arr: PDFArray): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    out.push(v.asNumber());
  }
  return out;
}

/** Replaces each x, y pair of a number array in place. Scaling by a positive
 * number and moving keeps a Rect's corners in lower-left / upper-right order. */
function mapArray(arr: PDFArray, map: Mapper) {
  const nums = numbersOf(arr);
  if (!nums || nums.length % 2 !== 0) return;
  for (let i = 0; i < nums.length; i += 2) {
    const [x, y] = map(nums[i]!, nums[i + 1]!);
    arr.set(i, PDFNumber.of(x));
    arr.set(i + 1, PDFNumber.of(y));
  }
}

export type InsertOptions = {
  /** Where the new pages go: 0 = before page 1, page count = at the end. */
  at: number;
  /** How many blank pages to add (ignored when another PDF is given). */
  blankCount: number;
};

/**
 * Inserts blank pages, or every page of another PDF (`other`), at one place.
 * Blank pages copy the size and turn of the page next to them, so they print
 * the same way.
 */
export async function insertPages(bytes: Uint8Array, opts: InsertOptions, other?: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  const total = doc.getPageCount();
  const at = Math.trunc(opts.at);
  if (!Number.isInteger(at) || at < 0 || at > total) throw new UserFacingError('Choose where to insert the pages.');

  if (other) {
    const src = await load(other);
    if (total + src.getPageCount() > MAX_PAGES) {
      throw new UserFacingError(`The result would have more than ${MAX_PAGES} pages.`);
    }
    const copied = await doc.copyPages(src, src.getPageIndices());
    copied.forEach((p, i) => doc.insertPage(at + i, p));
    return save(doc);
  }

  const count = Math.trunc(clamp(opts.blankCount, 1, 1000));
  if (total + count > MAX_PAGES) throw new UserFacingError(`The result would have more than ${MAX_PAGES} pages.`);
  const neighbour = doc.getPage(at > 0 ? at - 1 : 0);
  const { width, height } = neighbour.getCropBox();
  const rotation = neighbour.getRotation();
  for (let i = 0; i < count; i++) {
    const blank = doc.insertPage(at + i, [width, height]);
    blank.setRotation(rotation);
  }
  return save(doc);
}
