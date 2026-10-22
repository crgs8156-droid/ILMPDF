// Removes pages from a PDF while keeping everything else in the file: the
// form, bookmarks, attached files and document details. (Organize builds a
// brand-new PDF and copies only the pages, which drops all of those. MuPDF's
// own rearrangePages() drops the form and attached files too.) Runs in the
// MuPDF worker, like the operations in mupdf-ops.ts.
import type * as MuPDF from 'mupdf';
import { checkPageLimit, open } from './mupdf-ops';
import { prepareOutline } from './mupdf-bookmarks';
import { UserFacingError } from './pdflib-ops';

type Mupdf = typeof MuPDF;

// Form fields nest (a field's /Kids can be fields or widgets); deeper than
// this is almost certainly a trap.
const MAX_FIELD_DEPTH = 32;

/** Deletes the given 0-based pages and returns the new PDF. */
export function removePages(mupdf: Mupdf, bytes: Uint8Array, drop: number[]): Uint8Array {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then remove pages.');
    // Scripts never run in ILMPDF; this keeps it that way if MuPDF ever gains them.
    pdf.disableJS();
    const count = pdf.countPages();
    checkPageLimit(count);
    const gone = [...new Set(drop)].sort((a, b) => b - a);
    for (const p of gone) {
      if (!Number.isInteger(p) || p < 0 || p >= count) throw new UserFacingError('A chosen page is out of range.');
    }
    if (gone.length >= count) throw new UserFacingError('Keep at least one page.');

    // Note the form fields' widgets on the removed pages before they go.
    const widgets = new Set<number>();
    for (const p of gone) {
      const annots = pdf.findPage(p).get('Annots');
      if (!annots.isArray()) continue;
      annots.forEach((annot) => {
        if (annot.isIndirect()) widgets.add(annot.asIndirect());
      });
    }
    // From the last page backwards, so the earlier page numbers stay valid.
    for (const p of gone) pdf.deletePage(p);

    // Bookmarks that went to a removed page stay as headings that go nowhere
    // (the same check the Bookmarks tool uses on damaged files).
    prepareOutline(pdf);
    // Fields whose widgets were on a removed page leave the form, so the form
    // doesn't list fields that no longer exist.
    const form = pdf.getTrailer().get('Root').get('AcroForm');
    if (form.isDictionary()) pruneFields(form.get('Fields'), widgets, 0);

    // "compact" also drops the removed pages' content from the saved file,
    // unless something else in the file (such as a link) still points at it.
    return new Uint8Array(pdf.saveToBuffer({ garbage: 'compact' }).asUint8Array());
  } finally {
    pdf.destroy();
  }
}

/**
 * Removes from a list of fields (or a field's /Kids) every widget in `gone`,
 * and every field left with no widgets. Returns how many entries remain.
 */
function pruneFields(list: MuPDF.PDFObject, gone: Set<number>, depth: number): number {
  if (!list.isArray()) return 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list.get(i);
    if (item.isIndirect() && gone.has(item.asIndirect())) {
      list.delete(i);
      continue;
    }
    if (!item.isDictionary()) continue; // a broken entry: leave it as it is
    const kids = item.get('Kids');
    if (kids.isArray() && kids.length > 0) {
      const left = depth < MAX_FIELD_DEPTH ? pruneFields(kids, gone, depth + 1) : kids.length;
      if (left === 0) list.delete(i);
    }
  }
  return list.length;
}
