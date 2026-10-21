// MuPDF operations, run inside the MuPDF worker on untrusted PDFs.
// The mupdf module is passed in so this file never loads the 10 MB engine
// by itself (and so unit tests can hand in the Node build).
import type * as MuPDF from 'mupdf';
import { MAX_ANNOTATIONS, MAX_INK_POINTS, MAX_PAGES } from '../core/limits';
import { UserFacingError } from './pdflib-ops';

/**
 * encrypted: the file uses PDF encryption at all.
 * needsPassword: it cannot be opened without a password.
 * (encrypted but no password needed means it only carries restrictions,
 * such as no printing, guarded by an owner password.)
 */
export type PdfInfo = { pages: number; encrypted: boolean; needsPassword: boolean };

type Mupdf = typeof MuPDF;

/** Opens a PDF, unlocking it first when a password is given. */
export function open(mupdf: Mupdf, bytes: Uint8Array, password?: string): MuPDF.PDFDocument {
  let doc: MuPDF.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  } catch {
    throw new UserFacingError('This file could not be read as a PDF. It may be damaged.');
  }
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new UserFacingError('This file is not a PDF.');
  }
  if (pdf.needsPassword() && password !== undefined && !pdf.authenticatePassword(password)) {
    pdf.destroy();
    throw new UserFacingError('That password is not correct.');
  }
  return pdf;
}

/** Page count and lock state, without needing the password. */
export function inspect(mupdf: Mupdf, bytes: Uint8Array): PdfInfo {
  const pdf = open(mupdf, bytes);
  try {
    const needsPassword = pdf.needsPassword();
    const encrypted = isEncrypted(mupdf, pdf);
    const pages = needsPassword ? 0 : pdf.countPages();
    checkPageLimit(pages);
    return { pages, encrypted, needsPassword };
  } finally {
    pdf.destroy();
  }
}

/** Refuses PDFs above the page limit, with the same message in every tool. */
export function checkPageLimit(pages: number): void {
  if (pages > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
}

// authenticatePassword() result bits (MuPDF): 2 = user password, 4 = owner password.
const USER = 2;
const OWNER = 4;

/**
 * Removes the password and any restrictions, given a password the person
 * already knows. There is deliberately no guessing or cracking.
 */
export function unlock(mupdf: Mupdf, bytes: Uint8Array, password: string): Uint8Array {
  const pdf = open(mupdf, bytes);
  try {
    if (!isEncrypted(mupdf, pdf)) {
      throw new UserFacingError("This PDF isn't password-protected, so there is nothing to unlock.");
    }
    const needsPassword = pdf.needsPassword();
    const result = pdf.authenticatePassword(password);
    if (needsPassword && !(result & (USER | OWNER))) {
      throw new UserFacingError('That password is not correct.');
    }
    if (!needsPassword && !(result & OWNER)) {
      throw new UserFacingError(
        'This PDF opens without a password but has restrictions (such as no printing). Enter its owner password to remove them.',
      );
    }
    // Pages can only be counted once the password is accepted.
    checkPageLimit(pdf.countPages());
    return new Uint8Array(pdf.saveToBuffer('decrypt,garbage=compact').asUint8Array());
  } finally {
    pdf.destroy();
  }
}

function isEncrypted(mupdf: Mupdf, pdf: MuPDF.PDFDocument): boolean {
  return pdf.needsPassword() || (pdf.getMetaData(mupdf.Document.META_ENCRYPTION) ?? 'None') !== 'None';
}

export type ProtectOptions = { password: string; allowPrint: boolean; allowCopy: boolean; allowEdit: boolean };

// PDF permission bits (PDF 2.0 spec, table 22). Bits not listed stay off.
const PERM = { print: 1 << 2, edit: 1 << 3, copy: 1 << 4, annotate: 1 << 5, forms: 1 << 8, accessibility: 1 << 9, assemble: 1 << 10, printHigh: 1 << 11 };
const PERM_BASE = -3904; // 0xFFFFF0C0: the reserved bits PDF requires, nothing allowed

/** Encrypts with AES-256 so the PDF only opens with the given password. */
export function protect(mupdf: Mupdf, bytes: Uint8Array, opts: ProtectOptions): Uint8Array {
  if (opts.password.length === 0) throw new UserFacingError('Enter a password.');
  if (opts.password.length > 127) throw new UserFacingError('Use a password of at most 127 characters.');
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF already has a password. Unlock it first.');
    checkPageLimit(pdf.countPages());
    let permissions = PERM_BASE | PERM.accessibility;
    if (opts.allowPrint) permissions |= PERM.print | PERM.printHigh;
    if (opts.allowCopy) permissions |= PERM.copy;
    if (opts.allowEdit) permissions |= PERM.edit | PERM.annotate | PERM.forms | PERM.assemble;
    // Options go in as an object (sent to MuPDF as JSON), never as a
    // comma-separated string: a password containing "," or "=" must not be
    // able to inject other save options.
    const out = pdf.saveToBuffer({
      encrypt: 'aes-256',
      'user-password': opts.password,
      // A random owner password nobody knows: if it matched the open password,
      // PDF apps would treat everyone as the owner and ignore the restrictions.
      'owner-password': randomSecret(),
      permissions: String(permissions),
      garbage: 'compact',
    });
    return new Uint8Array(out.asUint8Array());
  } finally {
    pdf.destroy();
  }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type RepairResult = { file: Uint8Array; pages: number; repaired: boolean };

/**
 * Rebuilds a damaged PDF. MuPDF repairs a broken cross-reference table while
 * opening the file (by scanning for every object); saving then writes a fresh,
 * consistent file with only the objects still in use.
 */
export function repair(mupdf: Mupdf, bytes: Uint8Array): RepairResult {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then repair it.');
    let pages = 0;
    try {
      pages = pdf.countPages();
    } catch {
      // A page tree MuPDF cannot follow counts as no pages recovered.
    }
    if (pages === 0) throw new UserFacingError('This PDF is too damaged to repair: no pages could be recovered.');
    checkPageLimit(pages);
    let out: MuPDF.Buffer;
    try {
      // Any password restrictions (no printing, etc.) are kept as they were.
      out = pdf.saveToBuffer({ garbage: 'compact' });
    } catch {
      throw new UserFacingError('This PDF is too damaged to repair.');
    }
    return { file: new Uint8Array(out.asUint8Array()), pages, repaired: pdf.wasRepaired() };
  } finally {
    pdf.destroy();
  }
}

export type CompressLevel = 'light' | 'recommended' | 'strong';
export type CompressResult = { file: Uint8Array; before: number; after: number; images: number };

// light: lossless only. The other two also re-save photos as JPEG and shrink
// any image sharper than `dpi` would need at the size of the largest page.
const LEVELS: Record<CompressLevel, { dpi: number; quality: number } | null> = {
  light: null,
  recommended: { dpi: 150, quality: 75 },
  strong: { dpi: 100, quality: 50 },
};

/**
 * Makes a PDF smaller. Every level rewrites the file without unused or
 * duplicate objects and packs small objects into compressed object streams.
 * If the result is not smaller, the original bytes are returned unchanged.
 */
export function compress(mupdf: Mupdf, bytes: Uint8Array, level: CompressLevel): CompressResult {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then compress it.');
    const pages = pdf.countPages();
    checkPageLimit(pages);
    const settings = LEVELS[level];
    const images = settings ? recompressImages(mupdf, pdf, largestPageInches(pdf, pages) * settings.dpi, settings.quality) : 0;
    const out = pdf.saveToBuffer({
      garbage: 'deduplicate',
      compress: 'yes',
      'compress-fonts': 'yes',
      'compress-images': 'yes',
      objstms: 'yes',
    });
    const file = new Uint8Array(out.asUint8Array());
    if (file.length >= bytes.length) return { file: bytes, before: bytes.length, after: bytes.length, images: 0 };
    return { file, before: bytes.length, after: file.length, images };
  } finally {
    pdf.destroy();
  }
}

function largestPageInches(pdf: MuPDF.PDFDocument, pages: number): number {
  let largest = 0;
  for (let i = 0; i < pages; i++) {
    const page = pdf.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    largest = Math.max(largest, Math.abs(x1 - x0) / 72, Math.abs(y1 - y0) / 72);
    page.destroy();
  }
  return largest || 11.7; // A4's long side, if no page has a size
}

const MIN_PIXELS = 128 * 128; // icons and logos: not worth touching
const MAX_PIXELS = 60_000_000; // above this, decoding could run out of memory

/**
 * Re-saves each suitable image as JPEG, shrinking it to at most `maxSide`
 * pixels on its long side. Returns how many images were replaced. An image is
 * left alone when it is a transparency mask, is black-and-white (1 bit), uses
 * a colour-key mask, or when JPEG would not make it clearly smaller.
 */
function recompressImages(mupdf: Mupdf, pdf: MuPDF.PDFDocument, maxSide: number, quality: number): number {
  const isImage = (obj: MuPDF.PDFObject) => obj.isStream() && obj.get('Subtype').toString() === '/Image';
  const masks = new Set<number>();
  for (let i = 1; i < pdf.countObjects(); i++) {
    const obj = pdf.newIndirect(i);
    if (!isImage(obj)) continue;
    for (const key of ['SMask', 'Mask']) {
      const ref = obj.get(key);
      if (ref.isIndirect()) masks.add(ref.asIndirect());
    }
  }
  let replaced = 0;
  for (let i = 1; i < pdf.countObjects(); i++) {
    const obj = pdf.newIndirect(i);
    if (!isImage(obj) || masks.has(i)) continue;
    if (obj.get('ImageMask').valueOf() === true || obj.get('Mask').isArray()) continue;
    if (obj.get('BitsPerComponent').valueOf() === 1) continue;
    const w = Number(obj.get('Width').valueOf());
    const h = Number(obj.get('Height').valueOf());
    if (!(w > 0 && h > 0) || w * h < MIN_PIXELS || w * h > MAX_PIXELS) continue;
    try {
      if (replaceWithJpeg(mupdf, pdf, obj, w, h, maxSide, quality)) replaced++;
    } catch {
      // An image MuPDF cannot decode stays exactly as it was.
    }
  }
  return replaced;
}

function replaceWithJpeg(
  mupdf: Mupdf,
  pdf: MuPDF.PDFDocument,
  obj: MuPDF.PDFObject,
  w: number,
  h: number,
  maxSide: number,
  quality: number,
): boolean {
  const original = obj.readRawStream().getLength();
  // Pixel data lives in WebAssembly memory, so free each piece when done
  // rather than waiting for the job to end.
  const owned: { destroy(): void }[] = [];
  const keep = <T extends { destroy(): void }>(x: T): T => (owned.push(x), x);
  try {
    const image = keep(pdf.loadImage(obj));
    const decoded = keep(image.toPixmap());
    const gray = decoded.getNumberOfComponents() === 1;
    const space = gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
    // Colour images (including CMYK and indexed ones) become plain RGB.
    const sameSpace = decoded.getColorSpace()?.getName() === space.getName() && !decoded.getAlpha();
    const pixels = sameSpace ? decoded : keep(decoded.convertToColorSpace(space, false));
    const scale = Math.min(1, maxSide / Math.max(w, h));
    let target = pixels;
    if (scale < 1) {
      // Draw the decoded pixels (without any transparency mask, which stays a
      // separate object) into a smaller canvas; MuPDF smooths while scaling.
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      target = keep(new mupdf.Pixmap(space, [0, 0, tw, th], false));
      target.clear(255);
      const device = keep(new mupdf.DrawDevice(mupdf.Matrix.identity, target));
      device.fillImage(keep(new mupdf.Image(pixels)), [tw, 0, 0, th, 0, 0], 1);
      device.close();
    }
    const jpeg = target.asJPEG(quality);
    if (jpeg.length > original * 0.9) return false;
    obj.writeRawStream(jpeg);
    obj.put('Filter', pdf.newName('DCTDecode'));
    obj.put('Width', target.getWidth());
    obj.put('Height', target.getHeight());
    obj.put('BitsPerComponent', 8);
    obj.put('ColorSpace', pdf.newName(gray ? 'DeviceGray' : 'DeviceRGB'));
    // The decoded pixels already have these applied.
    obj.delete('DecodeParms');
    obj.delete('Decode');
    return true;
  } finally {
    for (const x of owned.reverse()) x.destroy();
  }
}

export type FormField = {
  name: string;
  /** The field's tooltip, or its name when it has none. Untrusted text from the PDF. */
  label: string;
  kind: 'text' | 'checkbox' | 'radio' | 'choice';
  value: string;
  checked: boolean;
  options: string[];
  multiline: boolean;
  readOnly: boolean;
  maxLen: number;
};
/** Field values to fill, as [field name, value] pairs. A list rather than an
 * object, so a field named "__proto__" (or similar) is just another name. */
export type FormValues = [string, string | boolean][];

const MAX_FIELDS = 1000;
const MAX_TEXT = 10_000;

/** Lists the fillable fields (push buttons and signature fields are left out). */
export function readForm(mupdf: Mupdf, bytes: Uint8Array): FormField[] {
  const pdf = openForForm(mupdf, bytes);
  try {
    const fields = new Map<string, FormField>();
    eachWidget(pdf, (widget, name) => {
      const kind = kindOf(widget);
      if (!kind) return;
      const existing = fields.get(name);
      if (!existing && fields.size >= MAX_FIELDS) {
        throw new UserFacingError(`This form has more than ${MAX_FIELDS} fields, which is above ILMPDF's limit.`);
      }
      if (kind === 'radio') {
        const field = existing ?? { ...base(widget, name, kind), options: [] as string[] };
        const label = radioLabel(widget, field.options.length);
        field.options.push(label);
        if (isOn(widget)) field.value = label;
        fields.set(name, field);
        return;
      }
      if (existing) return; // the same field shown in several places
      const field = base(widget, name, kind);
      if (kind === 'checkbox') field.checked = isOn(widget);
      if (kind === 'choice') field.options = widget.getOptions();
      if (kind === 'text' || kind === 'choice') field.value = widget.getValue();
      fields.set(name, field);
    });
    return [...fields.values()];
  } finally {
    pdf.destroy();
  }
}

/**
 * Fills fields by name and saves. With `flatten`, the filled fields are
 * drawn into the pages and removed, so nobody can change them afterwards
 * (comments and other annotations are kept as they are).
 */
export function fillForm(mupdf: Mupdf, bytes: Uint8Array, values: FormValues, flatten: boolean): Uint8Array {
  const pdf = openForForm(mupdf, bytes);
  try {
    const wanted = new Map(values);
    const radioIndex = new Map<string, number>();
    eachWidget(pdf, (widget, name) => {
      const kind = kindOf(widget);
      if (!kind) return;
      // Count every radio button, even read-only ones, so labels line up with readForm().
      const index = kind === 'radio' ? (radioIndex.get(name) ?? 0) : 0;
      if (kind === 'radio') radioIndex.set(name, index + 1);
      if (!wanted.has(name) || widget.isReadOnly()) return;
      const value = wanted.get(name);
      if (kind === 'text' && typeof value === 'string') {
        const limit = widget.getMaxLen() > 0 ? Math.min(widget.getMaxLen(), MAX_TEXT) : MAX_TEXT;
        const text = value.slice(0, limit);
        if (text !== widget.getValue()) widget.setTextValue(text);
      } else if (kind === 'choice' && typeof value === 'string') {
        if (value !== widget.getValue() && widget.getOptions().includes(value)) widget.setChoiceValue(value);
      } else if (kind === 'checkbox' && typeof value === 'boolean') {
        if (value !== isOn(widget)) widget.toggle();
      } else if (kind === 'radio' && typeof value === 'string') {
        if (value === radioLabel(widget, index) && !isOn(widget)) widget.toggle();
      }
      widget.update();
    });
    if (flatten) pdf.bake(false, true);
    return new Uint8Array(pdf.saveToBuffer({ garbage: 'compact' }).asUint8Array());
  } finally {
    pdf.destroy();
  }
}

function openForForm(mupdf: Mupdf, bytes: Uint8Array): MuPDF.PDFDocument {
  const pdf = open(mupdf, bytes);
  if (pdf.needsPassword()) {
    pdf.destroy();
    throw new UserFacingError('This PDF has a password. Unlock it first, then fill it in.');
  }
  // Form scripts never run in ILMPDF (this build of MuPDF has no JavaScript
  // engine anyway); this keeps it that way if that ever changes.
  pdf.disableJS();
  return pdf;
}

function eachWidget(pdf: MuPDF.PDFDocument, fn: (widget: MuPDF.PDFWidget, name: string) => void) {
  const pages = pdf.countPages();
  checkPageLimit(pages);
  for (let i = 0; i < pages; i++) {
    const page = pdf.loadPage(i);
    for (const widget of page.getWidgets()) fn(widget, widget.getName());
    page.destroy();
  }
}

function kindOf(widget: MuPDF.PDFWidget): FormField['kind'] | null {
  switch (widget.getFieldType()) {
    case 'text':
      return 'text';
    case 'checkbox':
      return 'checkbox';
    case 'radiobutton':
      return 'radio';
    case 'combobox':
    case 'listbox':
      return 'choice';
    default:
      return null; // push buttons and signatures
  }
}

function base(widget: MuPDF.PDFWidget, name: string, kind: FormField['kind']): FormField {
  return {
    name,
    label: widget.getLabel() || name,
    kind,
    value: '',
    checked: false,
    options: [],
    multiline: kind === 'text' && widget.isMultiline(),
    readOnly: widget.isReadOnly(),
    maxLen: kind === 'text' ? widget.getMaxLen() : 0,
  };
}

/** A checkbox or radio button is on when its appearance state isn't "Off". */
function isOn(widget: MuPDF.PDFWidget): boolean {
  const state = widget.getObject().get('AS');
  return state.isName() && state.asName() !== 'Off';
}

/** The name of the "on" appearance of a checkbox or radio button. */
function onState(widget: MuPDF.PDFWidget): string {
  let on = '';
  widget.getObject().get('AP', 'N').forEach((_value, key) => {
    if (key !== 'Off' && !on) on = String(key);
  });
  return on;
}

/**
 * What to call one radio button. Some PDF apps name each button's "on" state
 * after the option ("Small"); others use its position ("0", "1") and list
 * the names separately, which the field's options give back.
 */
function radioLabel(widget: MuPDF.PDFWidget, index: number): string {
  const on = onState(widget);
  const options = widget.getOptions();
  if (/^\d+$/.test(on) && options[Number(on)] !== undefined) return options[Number(on)]!;
  return on || options[index] || `Option ${index + 1}`;
}

export type TextResult = { pages: string[]; chars: number };

// Control characters other than tab and newline, and the Unicode marks that
// silently reverse or hide text direction. They have no place in a plain
// text file and can make the saved text look different from what it is.
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/** Plain-text clean-up: one kind of line ending, no unsafe characters, no trailing blank space. */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(UNSAFE_CHARS, '').trimEnd();
}

/**
 * Reads the text of every page, in reading order as MuPDF finds it.
 * Scanned pages (pictures of text) give nothing: that needs OCR.
 */
export function extractText(mupdf: Mupdf, bytes: Uint8Array): TextResult {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then extract its text.');
    const count = pdf.countPages();
    checkPageLimit(count);
    const pages: string[] = [];
    let chars = 0;
    for (let i = 0; i < count; i++) {
      const page = pdf.loadPage(i);
      try {
        const stext = page.toStructuredText('');
        try {
          const text = cleanText(stext.asText());
          chars += text.replace(/\s/g, '').length;
          pages.push(text);
        } finally {
          stext.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return { pages, chars };
  } finally {
    pdf.destroy();
  }
}

/** The kinds of annotation the Annotate tool can add. */
export type AnnotKind = 'text' | 'highlight' | 'rect' | 'line' | 'arrow' | 'ink' | 'note';

/**
 * One annotation to add. Positions are fractions (0 to 1) of the page as it
 * is shown on screen, from its top-left corner: (x1, y1) and (x2, y2) are
 * opposite corners of the box, or the two ends of a line. A note uses only
 * (x1, y1), the top-left corner of its icon.
 */
export type NewAnnotation = {
  page: number;
  kind: AnnotKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Red, green and blue, each from 0 to 1. */
  color: [number, number, number];
  /** The words of a text box or note. */
  text?: string;
  /** Text box font size, in points. */
  fontSize?: number;
  /**
   * A freehand ("ink") drawing: one stroke of points, each a fraction of the
   * page like x1/y1. The box (x1, y1)-(x2, y2) is ignored for ink.
   */
  points?: [number, number][];
};

const MAX_ANNOT_TEXT = 5_000;
const NOTE_SIZE = 20; // points: the usual size of a comment icon

const unit = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Adds annotations to pages. They are real PDF annotations, so Preview and
 * Acrobat can still move, edit or delete them later.
 *
 * MuPDF takes annotation positions in the page's on-screen space (rotation
 * applied, origin at the top-left of the visible area, in points), which is
 * exactly what the fractions describe, so no rotation maths is needed here.
 * MuPDF also draws text upright on rotated pages.
 */
export function annotate(mupdf: Mupdf, bytes: Uint8Array, items: NewAnnotation[]): Uint8Array {
  if (items.length === 0) throw new UserFacingError('Add at least one annotation first.');
  if (items.length > MAX_ANNOTATIONS) throw new UserFacingError(`ILMPDF adds at most ${MAX_ANNOTATIONS} annotations at a time.`);
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then annotate it.');
    const count = pdf.countPages();
    if (count > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
    // Scripts never run in ILMPDF; this keeps it that way if MuPDF ever gains them.
    pdf.disableJS();
    const byPage = new Map<number, NewAnnotation[]>();
    for (const item of items) {
      if (!Number.isInteger(item.page) || item.page < 0 || item.page >= count) {
        throw new UserFacingError(`This PDF has no page ${item.page + 1}.`);
      }
      byPage.set(item.page, [...(byPage.get(item.page) ?? []), item]);
    }
    for (const [index, list] of byPage) {
      const page = pdf.loadPage(index);
      try {
        const [bx0, by0, bx1, by1] = page.getBounds();
        const w = bx1 - bx0;
        const h = by1 - by0;
        for (const item of list) addOne(page, item, w, h);
      } finally {
        page.destroy();
      }
    }
    return new Uint8Array(pdf.saveToBuffer({ garbage: 'compact' }).asUint8Array());
  } finally {
    pdf.destroy();
  }
}

function addOne(page: MuPDF.PDFPage, item: NewAnnotation, w: number, h: number) {
  const color = item.color.map(unit) as [number, number, number];
  const x1 = unit(item.x1) * w;
  const y1 = unit(item.y1) * h;
  const x2 = unit(item.x2) * w;
  const y2 = unit(item.y2) * h;
  const box: [number, number, number, number] = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  const text = cleanText(item.text ?? '').slice(0, MAX_ANNOT_TEXT);
  const tooSmall = box[2] - box[0] < 2 || box[3] - box[1] < 2;

  switch (item.kind) {
    case 'text': {
      if (!text.trim()) throw new UserFacingError('A text box needs some text.');
      if (tooSmall) throw new UserFacingError('A text box is too small.');
      const size = Number.isFinite(item.fontSize) ? Math.min(72, Math.max(6, item.fontSize!)) : 12;
      const annot = page.createAnnotation('FreeText');
      annot.setRect(box);
      annot.setContents(text);
      annot.setDefaultAppearance('Helv', size, color);
      annot.setBorderWidth(0);
      annot.update();
      // MuPDF adds a callout line (CL) pointing at the page corner. It is
      // ignored by most viewers, but nothing here asked for it.
      annot.getObject().delete('CL');
      annot.update();
      return;
    }
    case 'highlight': {
      if (tooSmall) throw new UserFacingError('A highlight is too small.');
      const annot = page.createAnnotation('Highlight');
      annot.setColor(color);
      const [l, t, r, b] = box;
      // Quad points run: top-left, top-right, bottom-left, bottom-right.
      annot.setQuadPoints([[l, t, r, t, l, b, r, b]]);
      annot.update();
      return;
    }
    case 'rect': {
      if (tooSmall) throw new UserFacingError('A rectangle is too small.');
      const annot = page.createAnnotation('Square');
      annot.setRect(box);
      annot.setColor(color);
      annot.setBorderWidth(2);
      annot.update();
      return;
    }
    case 'line':
    case 'arrow': {
      const name = item.kind === 'arrow' ? 'An arrow' : 'A line';
      if (Math.hypot(x2 - x1, y2 - y1) < 2) throw new UserFacingError(`${name} is too short.`);
      const annot = page.createAnnotation('Line');
      annot.setLine([x1, y1], [x2, y2]);
      // An arrow is a line annotation with an open arrowhead at its end, so
      // Preview and Acrobat still treat it as a normal, editable line.
      if (item.kind === 'arrow') annot.setLineEndingStyles('None', 'OpenArrow');
      annot.setColor(color);
      annot.setBorderWidth(2);
      annot.update();
      return;
    }
    case 'ink': {
      const raw = Array.isArray(item.points) ? item.points : [];
      if (raw.length > MAX_INK_POINTS) throw new UserFacingError(`A drawing can have at most ${MAX_INK_POINTS} points.`);
      const stroke = raw
        .filter((pt) => Array.isArray(pt) && pt.length === 2)
        .map(([px, py]): [number, number] => [unit(px) * w, unit(py) * h]);
      if (stroke.length < 2) throw new UserFacingError('A drawing is too short.');
      const annot = page.createAnnotation('Ink');
      annot.setInkList([stroke]);
      annot.setColor(color);
      annot.setBorderWidth(2);
      annot.update();
      return;
    }
    case 'note': {
      if (!text.trim()) throw new UserFacingError('A comment needs some text.');
      const left = Math.min(x1, Math.max(0, w - NOTE_SIZE));
      const top = Math.min(y1, Math.max(0, h - NOTE_SIZE));
      const annot = page.createAnnotation('Text');
      annot.setRect([left, top, left + NOTE_SIZE, top + NOTE_SIZE]);
      annot.setIcon('Comment');
      annot.setColor(color);
      annot.setContents(text);
      annot.update();
      return;
    }
    default:
      throw new UserFacingError('Unknown kind of annotation.');
  }
}

/**
 * An area to redact: the 0-based page, and the area's top-left corner, width
 * and height as fractions of the page as it is shown on screen (after any
 * page rotation), the same way the Crop and Sign tools measure.
 */
export type RedactBox = { page: number; x: number; y: number; width: number; height: number };
/**
 * stripMetadata: also remove the document details and tagging.
 * phrases: the words or phrases searched for with "Mark all". Together with
 * the words under the boxes, they decide which bookmarks and attached files
 * mention the redacted text and are removed.
 * removeAllAttachments: remove every attached file, matching or not.
 */
export type RedactOptions = { stripMetadata?: boolean; phrases?: string[]; removeAllAttachments?: boolean };
/**
 * bookmarks, attachments and comments: how many were removed. unchecked: the names of
 * attached files that were kept because their contents could not be read to
 * look for the redacted text (untrusted text from the PDF).
 */
export type RedactResult = {
  file: Uint8Array;
  boxes: number;
  pages: number;
  bookmarks: number;
  attachments: number;
  comments: number;
  unchecked: string[];
};
/** fields: how many of the boxes are filled-in form fields. */
export type FindResult = { boxes: RedactBox[]; fields: number };

export const MAX_REDACT_BOXES = 10_000;
const MAX_SEARCH = 200;
const MAX_PHRASES = 100;
const MAX_WORDS = 5_000;
const MAX_BOOKMARKS = 10_000;
const MAX_ATTACHMENTS = 1_000;
const MAX_UNCHECKED_NAMES = 20;
const MAX_LABEL = 200;

/**
 * Finds every place a word or phrase appears (ignoring upper/lower case and
 * accents) and gives back one box per line of each match, ready to redact.
 * Filled-in text fields and lists whose value contains it are found too: the
 * box then covers the whole field, so redacting removes the field.
 */
export function findText(mupdf: Mupdf, bytes: Uint8Array, needle: string): FindResult {
  const text = needle.trim();
  if (!text) throw new UserFacingError('Type the text to find.');
  if (text.length > MAX_SEARCH) throw new UserFacingError(`Search for at most ${MAX_SEARCH} characters at a time.`);
  const wanted = normalize(text);
  const pdf = openForRedaction(mupdf, bytes);
  try {
    const found: RedactBox[] = [];
    let fields = 0;
    const add = (page: number, view: ReturnType<typeof pageView>, rect: MuPDF.Rect) => {
      if (found.length >= MAX_REDACT_BOXES) {
        throw new UserFacingError(`That text appears more than ${MAX_REDACT_BOXES} times, which is above ILMPDF's limit.`);
      }
      // A point of margin all round, so the edges of letters are covered too.
      found.push({ page, ...view.toFraction(padRect(rect, 1)) });
    };
    const count = pdf.countPages();
    for (let i = 0; i < count; i++) {
      const page = pdf.loadPage(i);
      try {
        const view = pageView(page);
        for (const hit of page.search(text, 'ignore-case,ignore-diacritics')) {
          for (const quad of hit) add(i, view, quadBounds(quad));
        }
        // A field's value is not part of the page text, so search it separately.
        for (const widget of page.getWidgets()) {
          const kind = kindOf(widget);
          if ((kind === 'text' || kind === 'choice') && normalize(widget.getValue()).includes(wanted)) {
            add(i, view, widget.getBounds());
            fields++;
          }
        }
      } finally {
        page.destroy();
      }
    }
    return { boxes: found, fields };
  } finally {
    pdf.destroy();
  }
}

/**
 * Text made comparable: accents removed, lower case, spaces collapsed, so
 * "Zoë  EXAMPLE" and "zoe example" match, as in the page search.
 */
function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Redacts for good: the text, image pixels and drawn shapes under each box
 * are deleted from the file (not just covered), then a black box is drawn in
 * their place. Links, comments and form fields that overlap a box are removed
 * too; a removed form field goes everywhere it is shown, not just under the
 * box. Bookmarks, attached files and comments anywhere in the file that
 * mention the redacted text (see RedactOptions) are removed as well, and so
 * is the small picture of each redacted page that some PDFs store (a
 * thumbnail, which would still show the redacted text). With `stripMetadata`, the document's
 * title, author and similar details, and its accessibility tagging (which can
 * hold copies of the page text), are removed too.
 *
 * Afterwards the saved file is opened again and checked: if any text is
 * still found under a box, or a removed field, bookmark, attached file,
 * comment or thumbnail is still there, the job fails rather than hand back an unsafe file.
 */
export function redact(mupdf: Mupdf, bytes: Uint8Array, boxes: RedactBox[], options: RedactOptions = {}): RedactResult {
  const pdf = openForRedaction(mupdf, bytes);
  try {
    const count = pdf.countPages();
    const byPage = groupBoxes(boxes, count);
    const phrases = new Set(
      (options.phrases ?? [])
        .slice(0, MAX_PHRASES)
        .map((p) => normalize(p.slice(0, MAX_SEARCH)))
        .filter((p) => p.length >= 3),
    );
    const removedFields = new Set<string>();
    for (const [index, areas] of byPage) {
      const page = pdf.loadPage(index);
      try {
        const view = pageView(page);
        const rects = areas.map((b) => view.toRect(b));
        const words = new Set(wordsUnder(page, rects));
        // A removed field's value is redacted text too.
        for (const value of removeOverlapping(pdf, page, rects, removedFields)) addWords(value, words);
        for (const word of words) if (phrases.size < MAX_PHRASES + MAX_WORDS) phrases.add(word);
        for (const rect of rects) {
          const annot = page.createAnnotation('Redact');
          annot.setRect(rect);
          annot.update();
        }
        page.applyRedactions(
          true,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS, // blank only the covered part of an image
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        );
        // Viewers draw their own thumbnails, so nothing visible is lost.
        pdf.findPage(index).delete('Thumb');
      } finally {
        page.destroy();
      }
    }
    removeFieldsEverywhere(pdf, removedFields);
    const matches = (text: string) => mentions(text, phrases);
    const bookmarks = removeBookmarks(pdf, matches);
    const comments = removeComments(pdf, matches);
    const { removed: attachments, unchecked } = removeAttachments(mupdf, pdf, matches, options.removeAllAttachments === true);
    if (options.stripMetadata) removeMetadata(pdf);
    // A full rewrite (never an incremental save), and "garbage" drops every
    // object no longer used, such as the page contents before redaction.
    const file = new Uint8Array(pdf.saveToBuffer({ garbage: 'compact' }).asUint8Array());
    checkRedacted(mupdf, file, byPage, removedFields, matches);
    const boxCount = [...byPage.values()].reduce((n, a) => n + a.length, 0);
    return { file, boxes: boxCount, pages: byPage.size, bookmarks, attachments, comments, unchecked };
  } finally {
    pdf.destroy();
  }
}

/** Whether `text` contains any of the (already normalized) phrases. */
function mentions(text: string, phrases: Set<string>): boolean {
  if (phrases.size === 0 || !text) return false;
  const t = normalize(text);
  for (const p of phrases) if (t.includes(p)) return true;
  return false;
}

/**
 * The words under the boxes, before they are removed, so bookmarks and
 * attached files that mention them can be found. Words shorter than three
 * letters or digits are left out: they would match almost anything.
 */
function wordsUnder(page: MuPDF.PDFPage, rects: MuPDF.Rect[]): string[] {
  const inside = (x: number, y: number) => rects.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
  const runs: string[] = [];
  let run = '';
  const flush = () => {
    if (run) runs.push(run);
    run = '';
  };
  const stext = page.toStructuredText('');
  try {
    stext.walk({
      onChar(c, _origin, _font, _size, quad) {
        const [x0, y0, x1, y1] = quadBounds(quad);
        if (inside((x0 + x1) / 2, (y0 + y1) / 2)) run += c;
        else flush();
      },
      endLine: flush,
    });
  } finally {
    stext.destroy();
  }
  flush();
  const words = new Set<string>();
  for (const r of runs) addWords(r, words);
  return [...words];
}

/** Adds the words of `text` (three letters or digits or longer) to `words`. */
function addWords(text: string, words: Set<string>) {
  for (const w of normalize(text).split(' ')) {
    // Punctuation at either end ("number:") is not part of the word.
    const word = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (word.length >= 3 && words.size < MAX_WORDS) words.add(word);
  }
}

/**
 * A form field can be shown in several places (on several pages), each
 * keeping its own picture of the value. Once its value is redacted, every
 * place it is shown is removed too.
 */
function removeFieldsEverywhere(pdf: MuPDF.PDFDocument, names: Set<string>) {
  if (names.size === 0) return;
  for (let i = 0; i < pdf.countPages(); i++) {
    const page = pdf.loadPage(i);
    try {
      for (const widget of page.getWidgets()) {
        if (!names.has(widget.getName())) continue;
        const obj = widget.getObject();
        clearFieldValue(obj);
        page.deleteAnnotation(widget);
        detachFromForm(pdf, obj);
      }
    } finally {
      page.destroy();
    }
  }
}

/**
 * The text a comment carries: its words, the same words with formatting
 * ("rich text"), its subject and the author's name.
 */
function commentTexts(obj: MuPDF.PDFObject): string[] {
  return ['Contents', 'RC', 'Subj', 'T'].map((k) => obj.get(k)).filter((v) => v.isString()).map((v) => v.asString());
}

// Form fields, links and redaction marks are handled elsewhere; attached
// files have their own rules (removeAttachments).
const NOT_COMMENTS = new Set(['Widget', 'Link', 'Redact', 'FileAttachment', 'Popup']);

/**
 * Removes the comments (sticky notes, text boxes, highlights...) anywhere in
 * the file whose text mentions the redacted text, not only the ones under a
 * box. Their pop-up notes go with them. Returns how many were removed.
 */
function removeComments(pdf: MuPDF.PDFDocument, matches: (text: string) => boolean): number {
  let removed = 0;
  for (let i = 0; i < pdf.countPages(); i++) {
    const page = pdf.loadPage(i);
    try {
      for (const annot of page.getAnnotations()) {
        if (NOT_COMMENTS.has(annot.getType())) continue;
        if (commentTexts(annot.getObject()).some(matches)) {
          page.deleteAnnotation(annot);
          removed++;
        }
      }
    } finally {
      page.destroy();
    }
  }
  return removed;
}

/** A bookmark, the open/closed state it had, and the bookmarks under it. */
type Bookmark = { obj: MuPDF.PDFObject; open: boolean; kids: Bookmark[] };

/**
 * Removes the bookmarks whose title mentions the redacted text. The
 * bookmarks under a removed one move up into its place, so the rest of the
 * list keeps working. Returns how many were removed.
 */
function removeBookmarks(pdf: MuPDF.PDFDocument, matches: (text: string) => boolean): number {
  const catalog = pdf.getTrailer().get('Root');
  let root = catalog.get('Outlines');
  if (!root.isDictionary()) return 0;
  const seen = new Set<number>();
  let total = 0;
  let removed = 0;

  // Reads one level of the list (following /Next), and the levels below it.
  const read = (first: MuPDF.PDFObject, depth: number): Bookmark[] => {
    const list: Bookmark[] = [];
    if (depth > MAX_DEPTH) return list;
    for (let item = first; item.isDictionary(); item = item.get('Next')) {
      // Hostile files can loop the list back on itself.
      if (item.isIndirect()) {
        if (seen.has(item.asIndirect())) break;
        seen.add(item.asIndirect());
      }
      if (++total > MAX_BOOKMARKS) throw new UserFacingError(`This PDF has more than ${MAX_BOOKMARKS} bookmarks, which is above ILMPDF's limit.`);
      const title = item.get('Title');
      const kids = read(item.get('First'), depth + 1);
      if (title.isString() && matches(title.asString())) {
        removed++;
        list.push(...kids);
      } else {
        const count = item.get('Count');
        list.push({ obj: item, open: count.isNumber() && count.asNumber() > 0, kids });
      }
    }
    return list;
  };
  const top = read(root.get('First'), 0);
  if (removed === 0) return 0;

  if (!root.isIndirect()) {
    root = pdf.addObject(root);
    catalog.put('Outlines', root);
  }
  // How many bookmarks show when this list is shown.
  const visible = (list: Bookmark[]): number => list.reduce((n, b) => n + 1 + (b.open ? visible(b.kids) : 0), 0);
  // Links each bookmark to its parent and neighbours again, and refreshes
  // the counts (negative for a closed bookmark, as the PDF format asks).
  const link = (parent: MuPDF.PDFObject, list: Bookmark[]) => {
    list.forEach((b) => {
      // Bookmarks written inline (not as separate objects) can't be linked to.
      if (!b.obj.isIndirect()) b.obj = pdf.addObject(b.obj);
    });
    if (list.length === 0) {
      parent.delete('First');
      parent.delete('Last');
    } else {
      parent.put('First', list[0]!.obj);
      parent.put('Last', list[list.length - 1]!.obj);
    }
    list.forEach((b, i) => {
      b.obj.put('Parent', parent);
      if (i > 0) b.obj.put('Prev', list[i - 1]!.obj);
      else b.obj.delete('Prev');
      if (i < list.length - 1) b.obj.put('Next', list[i + 1]!.obj);
      else b.obj.delete('Next');
      link(b.obj, b.kids);
      if (b.kids.length === 0) b.obj.delete('Count');
      else b.obj.put('Count', b.open ? visible(b.kids) : -visible(b.kids));
    });
  };
  link(root, top);
  if (top.length === 0) catalog.delete('Outlines');
  else root.put('Count', visible(top));
  return removed;
}

/** Where an attached file is listed. One file can be listed in several places. */
type AttachmentPlace =
  | { kind: 'list'; name: string }
  | { kind: 'af'; owner: MuPDF.PDFObject; spec: MuPDF.PDFObject }
  | { kind: 'annot'; page: number; annot: MuPDF.PDFObject };
type Attachment = { spec: MuPDF.PDFObject; label: string; texts: string[]; places: AttachmentPlace[] };

/**
 * Removes the attached files that mention the redacted text in their name,
 * description or contents (or every one, with `all`). Files are found in the
 * document's list of attached files, in "associated files" entries, and in
 * paperclip comments on the pages. Files whose contents can't be read as
 * text or as a PDF are kept and named in `unchecked`.
 */
function removeAttachments(
  mupdf: Mupdf,
  pdf: MuPDF.PDFDocument,
  matches: (text: string) => boolean,
  all: boolean,
): { removed: number; unchecked: string[] } {
  const found = new Map<string, Attachment>();
  let direct = 0;
  const note = (spec: MuPDF.PDFObject, place: AttachmentPlace, ...texts: string[]) => {
    if (!spec.isDictionary()) return;
    const key = spec.isIndirect() ? `obj ${spec.asIndirect()}` : `inline ${direct++}`;
    let entry = found.get(key);
    if (!entry) {
      if (found.size >= MAX_ATTACHMENTS) throw new UserFacingError(`This PDF has more than ${MAX_ATTACHMENTS} attached files, which is above ILMPDF's limit.`);
      const own = ['UF', 'F', 'Desc'].map((k) => spec.get(k)).filter((v) => v.isString()).map((v) => v.asString());
      // The label is shown to the user, so hidden characters are taken out.
      const label = cleanText(own[0] || texts[0] || '').trim().slice(0, MAX_LABEL) || 'unnamed file';
      entry = { spec, label, texts: own, places: [] };
      found.set(key, entry);
    }
    entry.texts.push(...texts.filter(Boolean));
    entry.places.push(place);
  };

  const catalog = pdf.getTrailer().get('Root');
  const list: [string, MuPDF.PDFObject][] = [];
  readNameTree(catalog.get('Names', 'EmbeddedFiles'), list);
  for (const [name, spec] of list) note(spec, { kind: 'list', name }, name);
  const noteAf = (owner: MuPDF.PDFObject) => {
    const af = deref(owner.get('AF'));
    if (af.isArray()) for (let i = 0; i < af.length; i++) note(af.get(i), { kind: 'af', owner, spec: af.get(i) });
    else if (af.isDictionary()) note(owner.get('AF'), { kind: 'af', owner, spec: owner.get('AF') });
  };
  noteAf(catalog);
  const pages = pdf.countPages();
  for (let i = 0; i < pages; i++) {
    const pageObj = pdf.findPage(i);
    noteAf(pageObj);
    const annots = deref(pageObj.get('Annots'));
    if (!annots.isArray()) continue;
    for (let j = 0; j < annots.length; j++) {
      const annot = annots.get(j);
      if (!annot.isDictionary() || nameOf(annot.get('Subtype')) !== 'FileAttachment') continue;
      const contents = annot.get('Contents');
      note(annot.get('FS'), { kind: 'annot', page: i, annot }, contents.isString() ? contents.asString() : '');
    }
  }
  if (found.size === 0) return { removed: 0, unchecked: [] };

  const doomed: Attachment[] = [];
  const unchecked: string[] = [];
  for (const entry of found.values()) {
    if (all || entry.texts.some(matches)) {
      doomed.push(entry);
      continue;
    }
    const contents = readAttachment(mupdf, pdf, entry.spec);
    if (contents === null) unchecked.push(entry.label);
    else if (matches(contents)) doomed.push(entry);
  }

  const goneNames = new Set<string>();
  const goneAnnots: { page: number; annot: MuPDF.PDFObject }[] = [];
  for (const entry of doomed) {
    for (const place of entry.places) {
      if (place.kind === 'list') goneNames.add(place.name);
      else if (place.kind === 'annot') goneAnnots.push(place);
      else {
        const af = deref(place.owner.get('AF'));
        if (af.isArray()) {
          for (let i = af.length - 1; i >= 0; i--) if (sameObject(af.get(i), place.spec)) af.delete(i);
          if (af.length === 0) place.owner.delete('AF');
        } else {
          place.owner.delete('AF');
        }
      }
    }
  }
  if (goneNames.size > 0) {
    // The list is written again without the removed files, as one flat list.
    const kept = list.filter(([name]) => !goneNames.has(name));
    const names = catalog.get('Names');
    if (kept.length === 0) {
      names.delete('EmbeddedFiles');
      // A "portfolio" is a PDF that is mainly a folder of attached files.
      catalog.delete('Collection');
    } else {
      const tree = pdf.newDictionary();
      const pairs = pdf.newArray();
      for (const [name, spec] of kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        pairs.push(pdf.newString(name));
        pairs.push(spec);
      }
      tree.put('Names', pairs);
      names.put('EmbeddedFiles', tree);
    }
  }
  for (const { page, annot } of goneAnnots) {
    const annots = deref(pdf.findPage(page).get('Annots'));
    if (!annots.isArray()) continue;
    // Its pop-up note (which points back to it) goes too, or it would keep the file in.
    const popup = annot.get('Popup');
    for (let i = annots.length - 1; i >= 0; i--) {
      const item = annots.get(i);
      if (sameObject(item, annot) || (!popup.isNull() && sameObject(item, popup)) || (item.isDictionary() && sameObject(item.get('Parent'), annot))) annots.delete(i);
    }
  }
  return { removed: doomed.length, unchecked: unchecked.slice(0, MAX_UNCHECKED_NAMES) };
}

function sameObject(a: MuPDF.PDFObject, b: MuPDF.PDFObject): boolean {
  if (a.isIndirect() || b.isIndirect()) return a.isIndirect() && b.isIndirect() && a.asIndirect() === b.asIndirect();
  // Values written inline: the same one is the same object inside MuPDF.
  return a.pointer === b.pointer;
}

/** Collects the [name, value] pairs of a name tree, such as the list of attached files. */
function readNameTree(node: MuPDF.PDFObject, out: [string, MuPDF.PDFObject][], depth = 0) {
  const obj = deref(node);
  if (depth > MAX_DEPTH || !obj.isDictionary()) return;
  const names = deref(obj.get('Names'));
  if (names.isArray()) {
    for (let i = 0; i + 1 < names.length; i += 2) {
      const key = names.get(i);
      if (out.length >= MAX_ATTACHMENTS) throw new UserFacingError(`This PDF has more than ${MAX_ATTACHMENTS} attached files, which is above ILMPDF's limit.`);
      out.push([key.isString() ? key.asString() : '', names.get(i + 1)]);
    }
  }
  const kids = deref(obj.get('Kids'));
  if (kids.isArray()) for (let i = 0; i < kids.length; i++) readNameTree(kids.get(i), out, depth + 1);
}

/**
 * An attached file's contents as text, to look for the redacted text: plain
 * text files as they are, and attached PDFs by their page text. Gives back
 * null when the contents can't be read that way (a Word file, an image, a
 * zip, a locked PDF, or a PDF that holds attached files of its own).
 */
function readAttachment(mupdf: Mupdf, pdf: MuPDF.PDFDocument, spec: MuPDF.PDFObject): string | null {
  let bytes: Uint8Array;
  try {
    const buffer = pdf.getEmbeddedFileContents(spec);
    if (!buffer) return '';
    bytes = buffer.asUint8Array();
  } catch {
    return null;
  }
  if (bytes.length === 0) return '';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return attachedPdfText(mupdf, bytes);
  try {
    let text: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    else text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Control characters other than tabs and line breaks mean it isn't really text.
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000e-\u001f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

function attachedPdfText(mupdf: Mupdf, bytes: Uint8Array): string | null {
  let inner: MuPDF.PDFDocument;
  try {
    inner = open(mupdf, bytes);
  } catch {
    return null;
  }
  try {
    if (inner.needsPassword() || inner.countPages() > MAX_PAGES) return null;
    const files: [string, MuPDF.PDFObject][] = [];
    readNameTree(inner.getTrailer().get('Root', 'Names', 'EmbeddedFiles'), files);
    if (files.length > 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < inner.countPages(); i++) {
      const page = inner.loadPage(i);
      try {
        const stext = page.toStructuredText('');
        parts.push(stext.asText());
        stext.destroy();
        for (const widget of page.getWidgets()) parts.push(widget.getValue());
      } finally {
        page.destroy();
      }
    }
    return parts.join('\n');
  } catch {
    return null;
  } finally {
    inner.destroy();
  }
}

function openForRedaction(mupdf: Mupdf, bytes: Uint8Array): MuPDF.PDFDocument {
  const pdf = open(mupdf, bytes);
  if (pdf.needsPassword()) {
    pdf.destroy();
    throw new UserFacingError('This PDF has a password. Unlock it first, then redact it.');
  }
  if (pdf.countPages() > MAX_PAGES) {
    pdf.destroy();
    throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
  }
  pdf.disableJS();
  return pdf;
}

/** Checks the boxes and sorts them by page; boxes are clipped to the page. */
function groupBoxes(boxes: RedactBox[], pages: number): Map<number, RedactBox[]> {
  if (boxes.length > MAX_REDACT_BOXES) {
    throw new UserFacingError(`Mark at most ${MAX_REDACT_BOXES} areas at a time.`);
  }
  const byPage = new Map<number, RedactBox[]>();
  for (const b of boxes) {
    if (!Number.isInteger(b.page) || b.page < 0 || b.page >= pages) continue;
    const x0 = clampUnit(b.x);
    const y0 = clampUnit(b.y);
    const x1 = clampUnit(b.x + b.width);
    const y1 = clampUnit(b.y + b.height);
    if (x1 <= x0 || y1 <= y0) continue;
    const list = byPage.get(b.page) ?? [];
    list.push({ page: b.page, x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    byPage.set(b.page, list);
  }
  if (byPage.size === 0) throw new UserFacingError('Mark at least one area to redact.');
  return byPage;
}

function clampUnit(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/**
 * MuPDF measures pages as they are shown: rotation already applied, origin at
 * the top-left corner, in points. That makes converting to and from the
 * on-screen fractions a simple scale.
 */
function pageView(page: MuPDF.PDFPage) {
  const [bx0, by0, bx1, by1] = page.getBounds();
  const w = bx1 - bx0;
  const h = by1 - by0;
  return {
    toRect: (b: RedactBox): MuPDF.Rect => [bx0 + b.x * w, by0 + b.y * h, bx0 + (b.x + b.width) * w, by0 + (b.y + b.height) * h],
    toFraction: ([x0, y0, x1, y1]: MuPDF.Rect) => {
      const fx0 = clampUnit((x0 - bx0) / w);
      const fy0 = clampUnit((y0 - by0) / h);
      return { x: fx0, y: fy0, width: clampUnit((x1 - bx0) / w) - fx0, height: clampUnit((y1 - by0) / h) - fy0 };
    },
  };
}

function quadBounds(q: MuPDF.Quad): MuPDF.Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function padRect([x0, y0, x1, y1]: MuPDF.Rect, by: number): MuPDF.Rect {
  return [x0 - by, y0 - by, x1 + by, y1 + by];
}

function overlaps(a: MuPDF.Rect, b: MuPDF.Rect): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * Links, comments and form fields sit on top of the page rather than in it,
 * so redaction alone would leave them (and the text they carry) behind.
 * Form fields are emptied before they are removed, because a field's value
 * can also be stored away from the page, in the form's list of fields.
 */
function removeOverlapping(pdf: MuPDF.PDFDocument, page: MuPDF.PDFPage, rects: MuPDF.Rect[], removedFields: Set<string>): string[] {
  const hit = (r: MuPDF.Rect) => rects.some((rect) => overlaps(r, rect));
  const values: string[] = [];
  for (const link of page.getLinks()) if (hit(link.getBounds())) page.deleteLink(link);
  for (const widget of page.getWidgets()) {
    if (!hit(widget.getBounds())) continue;
    removedFields.add(widget.getName());
    const kind = kindOf(widget);
    if (kind === 'text' || kind === 'choice') values.push(widget.getValue());
    const obj = widget.getObject();
    clearFieldValue(obj);
    page.deleteAnnotation(widget);
    detachFromForm(pdf, obj);
  }
  for (const annot of page.getAnnotations()) {
    if (annot.getType() !== 'Redact' && hit(annot.getBounds())) page.deleteAnnotation(annot);
  }
  return values;
}

/** Deletes the stored value of a form field, up through its parent fields. */
function clearFieldValue(obj: MuPDF.PDFObject) {
  for (let node = obj, depth = 0; node.isDictionary() && depth < 32; node = node.get('Parent'), depth++) {
    node.delete('V');
    node.delete('DV');
  }
}

/**
 * Takes a removed form field out of the form's list of fields too, so
 * nothing refers to it any more and saving drops it, along with its picture
 * of the old value (its "appearance").
 */
function detachFromForm(pdf: MuPDF.PDFDocument, obj: MuPDF.PDFObject) {
  if (!obj.isIndirect()) return;
  const parent = obj.get('Parent');
  const list = parent.isDictionary() ? parent.get('Kids') : pdf.getTrailer().get('Root', 'AcroForm', 'Fields');
  if (!list.isArray()) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list.get(i);
    if (item.isIndirect() && item.asIndirect() === obj.asIndirect()) list.delete(i);
  }
  obj.delete('AP');
}

/** Removes the document details (title, author...) and the accessibility tagging. */
function removeMetadata(pdf: MuPDF.PDFDocument) {
  const trailer = pdf.getTrailer();
  trailer.delete('Info');
  const root = trailer.get('Root');
  for (const key of ['Metadata', 'StructTreeRoot', 'MarkInfo', 'PieceInfo']) root.delete(key);
  for (let i = 0; i < pdf.countPages(); i++) {
    const page = pdf.findPage(i);
    for (const key of ['Metadata', 'PieceInfo', 'StructParents']) page.delete(key);
  }
}

/**
 * Re-opens the result and makes sure no text or form field is left under any
 * box, no removed form field is shown anywhere, and no bookmark or attached
 * file still mentions the redacted text by name.
 */
function checkRedacted(
  mupdf: Mupdf,
  file: Uint8Array,
  byPage: Map<number, RedactBox[]>,
  removedFields: Set<string>,
  matches: (text: string) => boolean,
) {
  const unsafe = () => new UserFacingError('Some content under the marked areas could not be removed, so nothing was saved.');
  const pdf = open(mupdf, file);
  try {
    for (const [index, areas] of byPage) {
      const page = pdf.loadPage(index);
      try {
        const view = pageView(page);
        // Shrunk by a hair so text that only touches a box's edge doesn't count.
        const rects = areas.map((b) => padRect(view.toRect(b), -0.5));
        const inside = (x: number, y: number) => rects.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
        let leftover = false;
        const stext = page.toStructuredText('');
        try {
          stext.walk({
            onChar(_c, _origin, _font, _size, quad) {
              const [x0, y0, x1, y1] = quadBounds(quad);
              if (inside((x0 + x1) / 2, (y0 + y1) / 2)) leftover = true;
            },
          });
        } finally {
          stext.destroy();
        }
        if (leftover || page.getWidgets().some((w) => rects.some((r) => overlaps(w.getBounds(), r)))) throw unsafe();
        if (!pdf.findPage(index).get('Thumb').isNull()) throw unsafe();
      } finally {
        page.destroy();
      }
    }
    const left = () => new UserFacingError('A bookmark, attached file, comment or form field with the redacted text could not be removed, so nothing was saved.');
    const pages = pdf.countPages();
    for (let i = 0; i < pages; i++) {
      const page = pdf.loadPage(i);
      try {
        if (removedFields.size > 0 && page.getWidgets().some((w) => removedFields.has(w.getName()))) throw left();
        for (const annot of page.getAnnotations()) {
          if (annot.getType() === 'FileAttachment' && (matches(annot.getContents()) || specMentions(annot.getObject().get('FS'), matches))) throw left();
          if (!NOT_COMMENTS.has(annot.getType()) && commentTexts(annot.getObject()).some(matches)) throw left();
        }
      } finally {
        page.destroy();
      }
    }
    const walk = (items: ReturnType<MuPDF.PDFDocument['loadOutline']> | undefined, depth = 0) => {
      if (!items || depth > MAX_DEPTH) return;
      for (const item of items) {
        if (matches(item.title ?? '')) throw left();
        walk(item.down, depth + 1);
      }
    };
    walk(pdf.loadOutline());
    const files: [string, MuPDF.PDFObject][] = [];
    readNameTree(pdf.getTrailer().get('Root', 'Names', 'EmbeddedFiles'), files);
    if (files.some(([name, spec]) => matches(name) || specMentions(spec, matches))) throw left();
  } finally {
    pdf.destroy();
  }
}

/** Whether an attached file's name or description mentions the redacted text. */
function specMentions(spec: MuPDF.PDFObject, matches: (text: string) => boolean): boolean {
  if (!spec.isDictionary()) return false;
  return ['UF', 'F', 'Desc'].some((k) => {
    const v = spec.get(k);
    return v.isString() && matches(v.asString());
  });
}

/**
 * What Remove scripts found and took out. Each number counts one item.
 * scripts: JavaScript (document-level, in actions, or `javascript:` links).
 * autoActions: other actions that ran by themselves on events such as
 * opening, closing, printing or saving.
 * openers: actions that launch a program or open another file.
 * dataActions: form actions that send data somewhere or load it in.
 * attachments: files embedded inside the PDF.
 * xfa: XFA form data (a second form layer that can carry scripts).
 */
export type SanitizeReport = {
  scripts: number;
  autoActions: number;
  openers: number;
  dataActions: number;
  attachments: number;
  xfa: number;
};
export type SanitizeResult = { file: Uint8Array | null; report: SanitizeReport };

/** Action types (/S) that are removed, and which count they go in. */
const RISKY_ACTIONS: Record<string, keyof SanitizeReport> = {
  JavaScript: 'scripts',
  Launch: 'openers',
  GoToR: 'openers',
  GoToE: 'openers',
  RichMediaExecute: 'openers',
  SubmitForm: 'dataActions',
  ImportData: 'dataActions',
};

// Hostile files can nest actions or name trees very deeply, or in loops.
const MAX_DEPTH = 64;

/** The counts so far, plus the attached files already counted. */
type Scan = SanitizeReport & { seenFiles: Set<number> };

function emptyReport(): SanitizeReport {
  return { scripts: 0, autoActions: 0, openers: 0, dataActions: 0, attachments: 0, xfa: 0 };
}

// MuPDF's empty value (for a missing key) has no document behind it and
// cannot be resolved, so only resolve real values.
function deref(obj: MuPDF.PDFObject): MuPDF.PDFObject {
  return obj.isNull() ? obj : obj.resolve();
}

function nameOf(obj: MuPDF.PDFObject): string {
  return obj.isName() ? obj.asName() : '';
}

/**
 * Checks one action and the chain of actions after it (/Next). Counts every
 * risky action it finds and returns true if any was found, in which case the
 * caller removes the whole chain.
 */
function scanAction(action: MuPDF.PDFObject, report: SanitizeReport, depth = 0): boolean {
  const obj = deref(action);
  if (depth > MAX_DEPTH) return true; // A chain this long is not a normal file: drop it.
  if (obj.isArray()) {
    let risky = false;
    for (let i = 0; i < obj.length; i++) risky = scanAction(obj.get(i), report, depth + 1) || risky;
    return risky;
  }
  if (!obj.isDictionary()) return false;
  let risky = false;
  const type = nameOf(obj.get('S'));
  const bucket = RISKY_ACTIONS[type];
  if (bucket) {
    report[bucket]++;
    risky = true;
  } else if (type === 'Rendition' && !obj.get('JS').isNull()) {
    // A media action that also carries a script.
    report.scripts++;
    risky = true;
  } else if (type === 'URI') {
    const uri = obj.get('URI');
    // Web links stay. Links that are really scripts in disguise go.
    if (uri.isString() && /^\s*javascript:/i.test(uri.asString())) {
      report.scripts++;
      risky = true;
    }
  }
  const next = obj.get('Next');
  if (!next.isNull()) risky = scanAction(next, report, depth + 1) || risky;
  return risky;
}

/** Counts the entries of a name tree (such as the list of attached files). */
function countNameTree(node: MuPDF.PDFObject, onValue: (value: MuPDF.PDFObject) => void, depth = 0): number {
  const obj = deref(node);
  if (depth > MAX_DEPTH || !obj.isDictionary()) return 0;
  let count = 0;
  const names = deref(obj.get('Names'));
  if (names.isArray()) {
    for (let i = 1; i < names.length; i += 2) onValue(names.get(i));
    count += Math.floor(names.length / 2);
  }
  const kids = deref(obj.get('Kids'));
  if (kids.isArray()) for (let i = 0; i < kids.length; i++) count += countNameTree(kids.get(i), onValue, depth + 1);
  return count;
}

/**
 * Counts one attached file. The same file is often listed in more than one
 * place (the file list and an associated-files entry), so each stored file
 * object is counted once.
 */
function countFile(spec: MuPDF.PDFObject, scan: Scan): void {
  if (spec.isIndirect()) {
    const num = spec.asIndirect();
    if (scan.seenFiles.has(num)) return;
    scan.seenFiles.add(num);
  }
  scan.attachments++;
}

/**
 * Cleans one dictionary or array, then the dictionaries and arrays written
 * directly inside it. Values stored as separate (indirect) objects are not
 * followed here, because sanitize() visits every object of the file anyway.
 */
function cleanObject(obj: MuPDF.PDFObject, report: Scan, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (obj.isDictionary()) {
    // Actions that run when something is clicked or the file is opened.
    for (const key of ['A', 'PA', 'OpenAction']) {
      const action = obj.get(key);
      if (!action.isNull() && scanAction(action, report)) obj.delete(key);
    }
    // Additional actions: run by themselves on events (open, close, print,
    // save, a field changing...). All of them go.
    const aa = deref(obj.get('AA'));
    if (!obj.get('AA').isNull()) {
      if (aa.isDictionary()) {
        aa.forEach((action) => {
          if (!scanAction(action, report)) report.autoActions++;
        });
      }
      obj.delete('AA');
    }
    // Paperclip annotations that hold an attached file.
    const annots = deref(obj.get('Annots'));
    if (annots.isArray()) {
      for (let i = annots.length - 1; i >= 0; i--) {
        const annot = deref(annots.get(i));
        if (annot.isDictionary() && nameOf(annot.get('Subtype')) === 'FileAttachment') {
          countFile(annot.get('FS'), report);
          annots.delete(i);
        }
      }
    }
    // Associated files (PDF 2.0): attached files linked to a page or the document.
    const af = obj.get('AF');
    if (!af.isNull()) {
      const list = deref(af);
      if (list.isArray()) for (let i = 0; i < list.length; i++) countFile(list.get(i), report);
      else countFile(af, report);
      obj.delete('AF');
    }
  }
  if (obj.isDictionary() || obj.isArray()) {
    obj.forEach((value) => {
      if (!value.isIndirect() && (value.isDictionary() || value.isArray())) cleanObject(value, report, depth + 1);
    });
  }
}

/** Document-wide parts that live in the catalog (the file's root object). */
function cleanCatalog(catalog: MuPDF.PDFObject, report: Scan): void {
  const names = deref(catalog.get('Names'));
  if (names.isDictionary()) {
    if (!names.get('JavaScript').isNull()) {
      report.scripts += Math.max(1, countNameTree(names.get('JavaScript'), () => {}));
      names.delete('JavaScript');
    }
    if (!names.get('EmbeddedFiles').isNull()) {
      countNameTree(names.get('EmbeddedFiles'), (spec) => countFile(spec, report));
      names.delete('EmbeddedFiles');
      // A "portfolio" is a PDF that is mainly a folder of attached files.
      catalog.delete('Collection');
    }
  }
  const form = deref(catalog.get('AcroForm'));
  if (form.isDictionary() && !form.get('XFA').isNull()) {
    form.delete('XFA');
    report.xfa++;
  }
}

/**
 * Removes JavaScript, actions that run by themselves, actions that launch
 * programs, open other files or send form data, XFA forms and attached
 * files. Pages, text, images, bookmarks, form fields, links within the
 * document and web links are kept.
 *
 * Returns no file when there was nothing to remove. The saved file is fully
 * rewritten (not appended to), so removed items are really gone from it.
 */
export function sanitize(mupdf: Mupdf, bytes: Uint8Array): SanitizeResult {
  const pdf = open(mupdf, bytes);
  try {
    if (pdf.needsPassword()) throw new UserFacingError('This PDF has a password. Unlock it first, then remove its scripts.');
    if (pdf.countPages() > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
    const report: Scan = { ...emptyReport(), seenFiles: new Set() };
    const catalog = deref(pdf.getTrailer().get('Root'));
    if (catalog.isDictionary()) cleanCatalog(catalog, report);
    // Visit every object in the file, so actions are found wherever they are
    // (pages, links, form fields, bookmarks, annotations...).
    const count = pdf.countObjects();
    for (let num = 1; num < count; num++) {
      const obj = deref(pdf.newIndirect(num));
      if (obj.isDictionary() || obj.isArray()) cleanObject(obj, report);
    }
    const { seenFiles: _, ...counts } = report;
    const found = Object.values(counts).some((n) => n > 0);
    if (!found) return { file: null, report: counts };
    // garbage: 'compact' drops the objects nothing points to any more (the
    // scripts and attached files). Password restrictions are kept as they were.
    const out = pdf.saveToBuffer({ garbage: 'compact' });
    return { file: new Uint8Array(out.asUint8Array()), report: counts };
  } finally {
    pdf.destroy();
  }
}
