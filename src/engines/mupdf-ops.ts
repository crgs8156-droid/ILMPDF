// MuPDF operations, run inside the MuPDF worker on untrusted PDFs.
// The mupdf module is passed in so this file never loads the 10 MB engine
// by itself (and so unit tests can hand in the Node build).
import type * as MuPDF from 'mupdf';
import { MAX_PAGES } from '../core/limits';
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
    if (pages > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
    return { pages, encrypted, needsPassword };
  } finally {
    pdf.destroy();
  }
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
    if (pages > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
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
    if (pages > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
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
  if (pages > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages, which is above ILMPDF's limit.`);
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
