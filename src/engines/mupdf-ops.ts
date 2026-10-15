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
