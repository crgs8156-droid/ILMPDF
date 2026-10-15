// All PDF editing logic. Pure functions over bytes, so they run inside a
// Web Worker in the app and directly under Node in unit tests.
import { degrees, PDFDocument, PDFName, rgb, StandardFonts, type PDFPage } from 'pdf-lib';
import { MAX_PAGES } from '../core/limits';

export class UserFacingError extends Error {}

// updateMetadata:false stops pdf-lib stamping its own Producer/Creator.
const LOAD = { updateMetadata: false } as const;

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, LOAD);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg)) {
      throw new UserFacingError('This PDF is password-protected. Remove the password with the Unlock tool first.');
    }
    throw new UserFacingError('This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.isEncrypted) {
    throw new UserFacingError('This PDF is password-protected. Remove the password with the Unlock tool first.');
  }
  let count: number;
  try {
    count = doc.getPageCount();
  } catch {
    // pdf-lib parses leniently; a missing page tree only shows up here.
    throw new UserFacingError('This file could not be read as a PDF. It may be damaged.');
  }
  if (count === 0) throw new UserFacingError('This PDF has no pages.');
  if (count > MAX_PAGES) throw new UserFacingError(`This PDF has more than ${MAX_PAGES} pages.`);
  return doc;
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount();
}

export async function merge(files: Uint8Array[]): Promise<Uint8Array> {
  if (files.length < 2) throw new UserFacingError('Add at least two PDFs to merge.');
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const bytes of files) {
    const src = await load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
    if (out.getPageCount() > MAX_PAGES) {
      throw new UserFacingError(`The merged PDF would have more than ${MAX_PAGES} pages.`);
    }
  }
  return save(out);
}

/** Builds one new PDF per group of 0-based page indices. */
export async function pick(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const src = await load(bytes);
  const total = src.getPageCount();
  const results: Uint8Array[] = [];
  for (const group of groups) {
    if (group.length === 0 || group.some((i) => !Number.isInteger(i) || i < 0 || i >= total)) {
      throw new UserFacingError('Page selection is out of range.');
    }
    const out = await PDFDocument.create({ updateMetadata: false });
    const pages = await out.copyPages(src, group);
    for (const p of pages) out.addPage(p);
    results.push(await save(out));
  }
  return results;
}

export type PagePlan = { index: number; rotate: 0 | 90 | 180 | 270 };

/** Reorders, deletes (by omission) and rotates pages. */
export async function organize(bytes: Uint8Array, plan: PagePlan[]): Promise<Uint8Array> {
  if (plan.length === 0) throw new UserFacingError('Keep at least one page.');
  const src = await load(bytes);
  const total = src.getPageCount();
  if (plan.some((p) => !Number.isInteger(p.index) || p.index < 0 || p.index >= total)) {
    throw new UserFacingError('Page selection is out of range.');
  }
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = await out.copyPages(
    src,
    plan.map((p) => p.index),
  );
  pages.forEach((page, i) => {
    const extra = plan[i]?.rotate ?? 0;
    if (![0, 90, 180, 270].includes(extra)) throw new UserFacingError('Invalid rotation.');
    page.setRotation(degrees((page.getRotation().angle + extra) % 360));
    out.addPage(page);
  });
  return save(out);
}

export type ImageInput = { bytes: Uint8Array; kind: 'jpg' | 'png' };
export type PageSize = 'fit' | 'a4' | 'letter';
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function imagesToPdf(images: ImageInput[], size: PageSize, margin = 0): Promise<Uint8Array> {
  if (images.length === 0) throw new UserFacingError('Add at least one image.');
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const img of images) {
    let embedded;
    try {
      embedded = img.kind === 'jpg' ? await out.embedJpg(img.bytes) : await out.embedPng(img.bytes);
    } catch {
      throw new UserFacingError('One of the images could not be read.');
    }
    const { width, height } = embedded;
    if (size === 'fit') {
      const page = out.addPage([width + 2 * margin, height + 2 * margin]);
      page.drawImage(embedded, { x: margin, y: margin, width, height });
    } else {
      const [pw, ph] = width > height ? [SIZES[size][1], SIZES[size][0]] : SIZES[size];
      const page = out.addPage([pw, ph]);
      const scale = Math.min((pw - 2 * margin) / width, (ph - 2 * margin) / height, 1);
      const w = width * scale;
      const h = height * scale;
      page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return save(out);
}

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'top-center' | 'top-right';

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: { position: NumberPosition; startAt: number; fontSize: number; format: 'n' | 'n-of-total' },
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const size = clamp(opts.fontSize, 6, 48);
  const start = Math.trunc(clamp(opts.startAt, 0, 100000));
  pages.forEach((page, i) => {
    const label = opts.format === 'n-of-total' ? `${start + i} of ${start + pages.length - 1}` : `${start + i}`;
    const width = font.widthOfTextAtSize(label, size);
    const { x, y } = placeLabel(page, opts.position, width, size);
    page.drawText(label, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
  });
  return save(doc);
}

function placeLabel(page: PDFPage, pos: NumberPosition, width: number, size: number) {
  const { x: bx, y: by, width: pw, height: ph } = page.getCropBox();
  const margin = 24;
  const x = pos.endsWith('right') ? bx + pw - margin - width : bx + (pw - width) / 2;
  const y = pos.startsWith('top') ? by + ph - margin - size : by + margin;
  return { x, y };
}

export async function addWatermark(
  bytes: Uint8Array,
  opts: { text: string; fontSize: number; opacity: number; diagonal: boolean },
): Promise<Uint8Array> {
  const text = opts.text.trim().slice(0, 200);
  if (!text) throw new UserFacingError('Enter watermark text.');
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = clamp(opts.fontSize, 8, 200);
  try {
    font.encodeText(text);
  } catch {
    throw new UserFacingError('Watermark text can only use basic Latin letters, digits and punctuation for now.');
  }
  const opacity = clamp(opts.opacity, 0.05, 1);
  for (const page of doc.getPages()) {
    const { x: bx, y: by, width: pw, height: ph } = page.getCropBox();
    const w = font.widthOfTextAtSize(text, size);
    const angle = opts.diagonal ? Math.atan2(ph, pw) : 0;
    const cx = bx + pw / 2;
    const cy = by + ph / 2;
    // Offset the start point so the text's centre sits on the page centre.
    const x = cx - (Math.cos(angle) * w) / 2 + (Math.sin(angle) * size) / 3;
    const y = cy - (Math.sin(angle) * w) / 2 - (Math.cos(angle) * size) / 3;
    page.drawText(text, {
      x,
      y,
      size,
      font,
      opacity,
      color: rgb(0.5, 0.5, 0.5),
      rotate: degrees((angle * 180) / Math.PI),
    });
  }
  return save(doc);
}

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];

export async function readMetadata(bytes: Uint8Array): Promise<Record<string, string>> {
  const doc = await load(bytes);
  const info: Record<string, string> = {};
  const add = (k: string, v: string | Date | undefined) => {
    if (v) info[k] = v instanceof Date ? v.toISOString() : v;
  };
  add('Title', doc.getTitle());
  add('Author', doc.getAuthor());
  add('Subject', doc.getSubject());
  add('Keywords', doc.getKeywords());
  add('Creator', doc.getCreator());
  add('Producer', doc.getProducer());
  add('Created', doc.getCreationDate());
  add('Modified', doc.getModificationDate());
  if (doc.catalog.has(PDFName.of('Metadata'))) info['XMP metadata'] = 'present';
  return info;
}

/** Removes the document info dictionary fields and the XMP metadata stream. */
export async function stripMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const info = doc.context.lookup(infoRef);
    if (info && 'delete' in info) {
      for (const k of INFO_KEYS) (info as { delete: (n: PDFName) => void }).delete(PDFName.of(k));
    }
  }
  doc.catalog.delete(PDFName.of('Metadata'));
  for (const page of doc.getPages()) page.node.delete(PDFName.of('Metadata'));
  return save(doc);
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
