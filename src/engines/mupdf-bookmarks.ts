// Bookmarks (the PDF "outline"): read them as a flat list, and write an
// edited list back. Runs inside the MuPDF worker on untrusted PDFs.
//
// The list is flat, with a `level` for nesting (0 = top level), because a
// flat list is simple to show, edit and check. MuPDF's outline iterator does
// the PDF bookkeeping (Parent/Prev/Next/First/Last/Count) when writing.
import type * as MuPDF from 'mupdf';
import { UserFacingError } from './pdflib-ops';
import { checkPageLimit, open } from './mupdf-ops';

type Mupdf = typeof MuPDF;

/**
 * One bookmark. `page` is 0-based, or null when the bookmark does not go to
 * a page in this file (a web link, a script, or a broken target).
 * `target` is the bookmark's original in-document jump (such as
 * "#page=3&view=FitH,720"), kept so an unchanged bookmark still lands on the
 * same spot of its page. It is only reused when it still points at `page`.
 */
export type Bookmark = { title: string; page: number | null; level: number; open: boolean; target?: string };

export const MAX_BOOKMARKS = 10_000;
export const MAX_LEVEL = 20;
export const MAX_TITLE = 500;
const MAX_TARGET = 1_000;

/** MuPDF's own outline item type, which the package does not export. */
type OutlineItem = NonNullable<ReturnType<MuPDF.PDFDocument['loadOutline']>>[number];

/** Removes control characters (which can hide or reorder text) and trims. */
export function cleanTitle(title: string): string {
  return title
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}

function openUnlocked(mupdf: Mupdf, bytes: Uint8Array): MuPDF.PDFDocument {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then edit its bookmarks.');
    // Scripts never run in ILMPDF; this keeps it that way if MuPDF ever gains them.
    pdf.disableJS();
    prepareOutline(pdf);
    return pdf;
  } catch (err) {
    pdf.destroy();
    throw err;
  }
}

/**
 * Walks the raw bookmark objects first, so damaged or hostile files are
 * handled before MuPDF reads them (MuPDF refuses the whole outline when one
 * part is bad): a list that loops back on itself is cut at the loop, a
 * bookmark pointing at a page that doesn't exist loses its target, and files
 * with too many bookmarks are refused. Only the in-memory copy changes.
 */
function prepareOutline(pdf: MuPDF.PDFDocument): void {
  const root = pdf.getTrailer().get('Root').get('Outlines');
  if (!root.isDictionary()) return;
  const pageCount = pdf.countPages();
  checkPageLimit(pageCount);
  // Object numbers of the real pages, to check where bookmarks point.
  const pageObjects = new Set<number>();
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.findPage(i);
    if (page.isIndirect()) pageObjects.add(page.asIndirect());
  }
  const seen = new Set<number>();
  let total = 0;
  const walk = (holder: MuPDF.PDFObject, key: 'First' | 'Next', depth: number) => {
    // Iterative along /Next, recursive (bounded) along /First.
    for (;;) {
      const item = holder.get(key);
      if (!item.isDictionary()) return;
      if (item.isIndirect()) {
        if (seen.has(item.asIndirect())) {
          holder.delete(key);
          return;
        }
        seen.add(item.asIndirect());
      }
      if (++total > MAX_BOOKMARKS) {
        throw new UserFacingError(`This PDF has more than ${MAX_BOOKMARKS} bookmarks, which is above ILMPDF's limit.`);
      }
      dropBrokenTarget(item, pageCount, pageObjects);
      if (depth < MAX_LEVEL) walk(item, 'First', depth + 1);
      else item.delete('First');
      holder = item;
      key = 'Next';
    }
  };
  walk(root, 'First', 0);
}

/**
 * Removes a bookmark's target when it is a page reference that is not a
 * page of this file (named targets are left to MuPDF, which skips unknown
 * ones by itself).
 */
function dropBrokenTarget(item: MuPDF.PDFObject, pageCount: number, pageObjects: Set<number>): void {
  let dest = item.get('Dest');
  const action = item.get('A');
  if (!dest.isArray() && action.isDictionary() && action.get('S').isName() && action.get('S').asName() === 'GoTo') dest = action.get('D');
  if (!dest.isArray()) return;
  const target = dest.get(0);
  const ok = target.isIndirect() ? pageObjects.has(target.asIndirect()) : target.isNumber() && Number.isInteger(target.asNumber()) && target.asNumber() >= 0 && target.asNumber() < pageCount;
  if (!ok) {
    item.delete('Dest');
    item.delete('A');
  }
}

/** Reads every bookmark, in order, as a flat list with nesting levels. */
export function readBookmarks(mupdf: Mupdf, bytes: Uint8Array): { bookmarks: Bookmark[]; pages: number } {
  const pdf = openUnlocked(mupdf, bytes);
  try {
    const pages = pdf.countPages();
    checkPageLimit(pages);
    const out: Bookmark[] = [];
    // MuPDF stops looped bookmark lists itself; the level cap stops very
    // deep nesting from flooding the screen.
    const walk = (items: OutlineItem[] | undefined, level: number) => {
      for (const item of items ?? []) {
        if (out.length >= MAX_BOOKMARKS) {
          throw new UserFacingError(`This PDF has more than ${MAX_BOOKMARKS} bookmarks, which is above ILMPDF's limit.`);
        }
        const page = typeof item.page === 'number' && item.page >= 0 && item.page < pages ? item.page : null;
        const uri = item.uri ?? '';
        const target = page !== null && uri.startsWith('#') && uri.length <= MAX_TARGET ? uri : undefined;
        out.push({ title: cleanTitle(item.title ?? ''), page, level: Math.min(level, MAX_LEVEL), open: !!item.open, ...(target ? { target } : {}) });
        walk(item.down, level + 1);
      }
    };
    walk(pdf.loadOutline() ?? [], 0);
    return { bookmarks: out, pages };
  } finally {
    pdf.destroy();
  }
}

/** Checks an edited list; returns an error message, or null when it is fine. */
export function checkBookmarks(list: Bookmark[], pages: number): string | null {
  if (list.length > MAX_BOOKMARKS) return `ILMPDF saves at most ${MAX_BOOKMARKS} bookmarks.`;
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    const prev = i === 0 ? -1 : list[i - 1]!.level;
    if (!Number.isInteger(b.level) || b.level < 0 || b.level > MAX_LEVEL) return `Bookmark ${i + 1} is nested too deeply.`;
    // A bookmark can sit at most one level below the one above it.
    if (b.level > prev + 1) return `Bookmark ${i + 1} is indented more than one step below the bookmark above it.`;
    if (b.page !== null && (!Number.isInteger(b.page) || b.page < 0 || b.page >= pages)) {
      return `Bookmark ${i + 1} points to page ${Number(b.page) + 1}, but this PDF has ${pages} pages.`;
    }
    if (typeof b.title !== 'string' || b.title.length > MAX_TITLE) return `Bookmark ${i + 1} has a title over ${MAX_TITLE} characters.`;
  }
  return null;
}

type Node = { item: Bookmark; kids: Node[] };

/** Turns the flat list back into a tree (the list must pass checkBookmarks). */
function toTree(list: Bookmark[]): Node[] {
  const top: Node[] = [];
  const stack: Node[] = [];
  for (const item of list) {
    const node: Node = { item, kids: [] };
    stack.length = item.level;
    (stack[item.level - 1]?.kids ?? top).push(node);
    stack.push(node);
  }
  return top;
}

/**
 * Replaces all bookmarks with `list` and returns the new PDF. An empty list
 * removes every bookmark. Everything else in the file stays as it was.
 */
export function writeBookmarks(mupdf: Mupdf, bytes: Uint8Array, list: Bookmark[]): Uint8Array {
  const pdf = openUnlocked(mupdf, bytes);
  try {
    const pages = pdf.countPages();
    checkPageLimit(pages);
    const problem = checkBookmarks(list, pages);
    if (problem) throw new UserFacingError(problem);

    const it = pdf.outlineIterator();
    try {
      // Delete the old bookmarks one by one (each delete moves to the next).
      for (let guard = 0; it.item() && guard <= MAX_BOOKMARKS * 2; guard++) it.delete();
      // Some hostile outlines can't be walked fully; start from a clean root.
      if (it.item()) throw new UserFacingError('The old bookmarks could not be removed, so nothing was saved.');
      const catalog = pdf.getTrailer().get('Root');
      if (catalog.get('Outlines').isDictionary()) catalog.delete('Outlines');
    } finally {
      it.destroy();
    }

    const fresh = pdf.outlineIterator();
    try {
      // insert() adds before the cursor; at an empty spot (the end of a
      // level) it appends and leaves the cursor at the end, so items go in
      // in order. For children: step back onto the new item, go down into
      // its (empty) child list, add them, then come back up and past it.
      const add = (nodes: Node[]) => {
        for (const { item, kids } of nodes) {
          const entry = { title: cleanTitle(item.title) || 'Untitled', uri: uriFor(pdf, item), open: false };
          fresh.insert(entry);
          if (kids.length === 0) continue;
          fresh.prev();
          fresh.down();
          add(kids);
          fresh.up();
          // "Open" (children shown) only takes once the children exist.
          if (item.open) fresh.update({ ...entry, open: true });
          fresh.next();
        }
      };
      add(toTree(list));
    } finally {
      fresh.destroy();
    }
    return new Uint8Array(pdf.saveToBuffer({ garbage: 'compact' }).asUint8Array());
  } finally {
    pdf.destroy();
  }
}

/**
 * The jump target to write: the original one when it still goes to the same
 * page (so the exact spot is kept), otherwise the whole page.
 */
function uriFor(pdf: MuPDF.PDFDocument, item: Bookmark): string | undefined {
  if (item.page === null) return undefined;
  const t = item.target;
  if (typeof t === 'string' && t.startsWith('#') && t.length <= MAX_TARGET) {
    try {
      if (pdf.resolveLink(t) === item.page) return t;
    } catch {
      // Not a target MuPDF understands: fall back to the whole page.
    }
  }
  return pdf.formatLinkURI({ type: 'Fit', chapter: 0, page: item.page, x: NaN, y: NaN, width: NaN, height: NaN, zoom: NaN });
}
