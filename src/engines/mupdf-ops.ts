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
