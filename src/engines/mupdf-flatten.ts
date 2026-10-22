// Flatten: draws form fields and annotations (comments, highlights,
// drawings, stamped signatures) into the page content, so they look the
// same but can no longer be edited, moved or removed. Runs in the MuPDF
// worker, like the operations in mupdf-ops.ts.
import type * as MuPDF from 'mupdf';
import { MAX_PAGES } from '../core/limits';
import { open } from './mupdf-ops';
import { UserFacingError } from './pdflib-ops';

type Mupdf = typeof MuPDF;

/** What to flatten. At least one must be true. */
export type FlattenOptions = { annotations: boolean; fields: boolean };

/**
 * annotations: how many annotations were flattened (links are never counted:
 * they stay clickable). fields: how many form fields (a radio group counts
 * once). signatures: how many of those fields held a digital signature,
 * which flattening makes invalid.
 */
export type FlattenResult = { file: Uint8Array; annotations: number; fields: number; signatures: number };

// Popups are the pop-up windows of other comments, not marks of their own,
// and links are not baked by MuPDF at all, so neither is counted.
const NOT_COUNTED = new Set(['Popup', 'Link']);

export function flatten(mupdf: Mupdf, bytes: Uint8Array, opts: FlattenOptions): FlattenResult {
  if (!opts.annotations && !opts.fields) throw new UserFacingError('Choose what to flatten first.');
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then flatten it.');
    const pages = pdf.countPages();
    if (pages > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
    // Form scripts never run in ILMPDF; this keeps it that way if MuPDF ever gains them.
    pdf.disableJS();

    let annotations = 0;
    const fieldNames = new Set<string>();
    const signed = new Set<string>();
    for (let i = 0; i < pages; i++) {
      const page = pdf.loadPage(i);
      try {
        if (opts.annotations) annotations += page.getAnnotations().filter((a) => !NOT_COUNTED.has(a.getType())).length;
        if (opts.fields) {
          for (const widget of page.getWidgets()) {
            const name = widget.getName();
            fieldNames.add(name);
            if (widget.getFieldType() === 'signature' && isSigned(widget)) signed.add(name);
          }
        }
      } finally {
        page.destroy();
      }
    }
    if (annotations === 0 && fieldNames.size === 0) {
      const what = opts.annotations && opts.fields ? 'form fields or annotations' : opts.fields ? 'form fields' : 'annotations';
      throw new UserFacingError(`Nothing to flatten: this PDF has no ${what}. No new file was saved.`);
    }

    // MuPDF's bake draws each item's appearance into the page and deletes the
    // item. Baking fields also removes the form itself (AcroForm, including
    // any XFA layer), so the result is no longer a fillable form.
    pdf.bake(opts.annotations, opts.fields);
    const out = pdf.saveToBuffer({ garbage: 'compact' });
    return { file: new Uint8Array(out.asUint8Array()), annotations, fields: fieldNames.size, signatures: signed.size };
  } finally {
    pdf.destroy();
  }
}

/** A signature field holds a signature when its value (/V) is filled in. */
function isSigned(widget: MuPDF.PDFWidget): boolean {
  // /V can sit on the widget or on its parent field (when one field has
  // several widgets).
  let obj = widget.getObject().resolve();
  for (let depth = 0; depth < 32 && obj.isDictionary(); depth++) {
    if (!obj.get('V').isNull()) return true;
    obj = obj.get('Parent').resolve();
  }
  return false;
}
