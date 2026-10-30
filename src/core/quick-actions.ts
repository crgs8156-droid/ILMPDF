// What each Drag Wheel slice does. Every action uses the same engines and
// defaults as its full tool (each job in its own fresh worker), saves a new
// file through a normal download, and returns a sentence for the result note.
import type { ImageFile, PdfFile } from './files';
import type { ImagesId, ManyId, QuickId } from './wheel';
import { copyBytes, runMupdfJob, runOcrJob, runPdfJob } from './orchestrator';
import { MAX_BATCH_BYTES, batchZip, runBatch, zipName, type BatchAction } from './batch';
import { describeRemoved, removeScripts } from './clean';
import { saveBytes } from './save';
import { formatBytes, safeFileName } from './validate';
import { makeZip, uniqueNames, type ZipEntry } from './zip';
import { closePdf, openPdf, pageToImage } from '../engines/pdfjs';

/** Same resolution as the PDF to images tool's default. */
const IMAGE_DPI = 150;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short "doing it" text shown on the wheel while the job runs. */
export const BUSY_TEXT: Record<QuickId | ManyId | ImagesId, string> = {
  compress: 'Compressing',
  png: 'Making PNGs',
  jpg: 'Making JPGs',
  text: 'Reading text',
  ocr: 'Recognising text',
  clean: 'Cleaning',
  flatten: 'Flattening',
  merge: 'Merging',
  compressAll: 'Compressing',
  textAll: 'Reading text',
  pngAll: 'Making PNGs',
  cleanAll: 'Cleaning',
  ocrAll: 'Recognising text',
  imgPdf: 'Making a PDF',
  imgFit: 'Making a PDF',
  imgOcr: 'Making a PDF',
};

export type QuickProgress = (text: string) => void;

// ---------------------------------------------------------------- one PDF

export async function runQuick(id: QuickId, file: PdfFile, onProgress: QuickProgress = () => {}): Promise<string> {
  switch (id) {
    case 'compress':
      return compress(file);
    case 'png':
    case 'jpg':
      return images(file, id, onProgress);
    case 'text':
      return text(file);
    case 'ocr':
      return ocr(file, onProgress);
    case 'clean':
      return clean(file);
    case 'flatten':
      return flatten(file);
  }
}

async function compress(file: PdfFile): Promise<string> {
  const out = await runMupdfJob({ op: 'compress', file: copyBytes(file.bytes), level: 'recommended' });
  const { before, after } = out.sizes!;
  // Like the Compress tool, never save a file that is not smaller.
  if (after >= before) return 'This PDF is already compact, so no file was saved. The Compress tool has a stronger level.';
  const name = safeFileName(file.name, '-compressed');
  saveBytes(out.files![0]!, name);
  return `Saved ${name}: ${formatBytes(before)} → ${formatBytes(after)} (${Math.round((1 - after / before) * 100)}% smaller).`;
}

/** Renders every page of one PDF as images, named after the file. */
async function pageImages(file: PdfFile, ext: 'png' | 'jpg', onPage: (n: number, count: number) => void): Promise<ZipEntry[]> {
  const format = ext === 'png' ? 'image/png' : 'image/jpeg';
  const base = safeFileName(file.name, '', '');
  const doc = await openPdf(file.bytes);
  try {
    const entries: ZipEntry[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      onPage(n, doc.numPages);
      const blob = await pageToImage(doc, n, format, IMAGE_DPI);
      entries.push({ name: `${base}-page-${n}.${ext}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    return entries;
  } finally {
    await closePdf(doc);
  }
}

// One page is saved as a single image; more pages go into one ZIP, because
// Safari asks before letting a page start many downloads at once.
async function images(file: PdfFile, id: 'png' | 'jpg', onProgress: QuickProgress): Promise<string> {
  const format = id === 'png' ? 'image/png' : 'image/jpeg';
  const entries = await pageImages(file, id, (n, count) => onProgress(`Page ${n} of ${count}`));
  if (entries.length === 1) {
    saveBytes(entries[0]!.bytes, entries[0]!.name, format);
    return `Saved ${entries[0]!.name}.`;
  }
  const name = `${safeFileName(file.name, '', '')}-pages-${id}.zip`;
  saveBytes(makeZip(entries), name, 'application/zip');
  return `Saved ${plural(entries.length, 'page')} as ${id.toUpperCase()} images in ${name}.`;
}

/** The text of one PDF as a .txt entry, or null when it has none. */
async function textOf(file: PdfFile): Promise<{ entry: ZipEntry | null; pages: number }> {
  const out = await runMupdfJob({ op: 'extractText', file: copyBytes(file.bytes) });
  const { pages, chars } = out.text!;
  if (chars === 0) return { entry: null, pages: pages.length };
  // Same layout as the PDF to text tool with "mark pages" on.
  const body = pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n');
  return { entry: { name: safeFileName(file.name, '', '.txt'), bytes: new TextEncoder().encode(`${body}\n`) }, pages: pages.length };
}

async function text(file: PdfFile): Promise<string> {
  const { entry, pages } = await textOf(file);
  if (!entry) return 'No text was found, so nothing was saved. This PDF is probably scanned: try the OCR slice first.';
  saveBytes(entry.bytes, entry.name, 'text/plain;charset=utf-8');
  return `Saved the text of ${plural(pages, 'page')} as ${entry.name}.`;
}

/** OCR of the pages without text. `bytes` is moved into the worker. */
async function ocrBytes(bytes: Uint8Array, onPage: (done: number, total: number) => void) {
  const out = await runOcrJob({ op: 'ocr', file: bytes, pages: [], skipText: true }, { onProgress: onPage });
  return { bytes: out.files?.[0], read: Number(out.meta?.read ?? 0), words: out.count ?? 0 };
}

async function ocr(file: PdfFile, onProgress: QuickProgress): Promise<string> {
  const { bytes, read, words } = await ocrBytes(copyBytes(file.bytes), (done, total) => onProgress(`Page ${done} of ${total}`));
  if (read === 0) return 'Every page already has text, so there was nothing to read. Nothing was saved.';
  if (words === 0) return `No words were recognised on ${plural(read, 'page')}, so nothing was saved.`;
  const name = safeFileName(file.name, '-ocr');
  saveBytes(bytes!, name);
  return `Made ${plural(read, 'page')} searchable (${plural(words, 'word')} recognised) and saved ${name}.`;
}

// Clean = Edit metadata's "remove all" plus Remove scripts, one after the other.
async function clean(file: PdfFile): Promise<string> {
  const stripped = await runPdfJob({ op: 'stripMetadata', file: copyBytes(file.bytes) });
  const { files: [out], removed } = await removeScripts(stripped.files!);
  const name = safeFileName(file.name, '-clean');
  saveBytes(out!, name);
  const found = describeRemoved(removed);
  return `Saved ${name}. Removed the hidden author, title and app details${found ? `, and ${found}` : '. No scripts or attached files were found'}.`;
}

async function flatten(file: PdfFile): Promise<string> {
  const out = await runMupdfJob({ op: 'flatten', file: copyBytes(file.bytes), opts: { fields: true, annotations: true } });
  const fields = Number(out.meta?.['fields'] ?? 0);
  const notes = Number(out.meta?.['annotations'] ?? 0);
  if (fields + notes === 0) return 'This PDF has no form fields or comments to flatten, so nothing was saved.';
  const name = safeFileName(file.name, '-flattened');
  saveBytes(out.files![0]!, name);
  return `Flattened ${plural(fields, 'form field')} and ${plural(notes, 'comment')} and saved ${name}.`;
}

// ---------------------------------------------------------- several PDFs

/**
 * Runs a several-PDFs slice. Files are handled one after another (each job
 * loads a full engine), in the order they were dragged. One file failing
 * does not stop the others; the note says which ones were skipped.
 */
export async function runMany(id: ManyId, files: PdfFile[], onProgress: QuickProgress = () => {}): Promise<string> {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_BATCH_BYTES) throw new Error(`These files add up to ${formatBytes(total)}, above the ${formatBytes(MAX_BATCH_BYTES)} limit for one go.`);
  switch (id) {
    case 'merge':
      return merge(files);
    case 'compressAll':
      return batch(files, { kind: 'compress', level: 'recommended' }, false, onProgress);
    case 'cleanAll':
      // Remove metadata, then (as "Also remove scripts") scripts and attached files.
      return batch(files, { kind: 'stripMetadata' }, true, onProgress);
    case 'textAll':
      return each(files, 'ilmpdf-text.zip', 'text files', onProgress, async (f) => {
        const { entry } = await textOf(f);
        if (!entry) throw new Error('no text found (probably scanned)');
        return [entry];
      });
    case 'pngAll':
      return each(files, 'ilmpdf-pages-png.zip', 'PNG images', onProgress, (f, step) =>
        pageImages(f, 'png', (n, count) => step(`page ${n} of ${count}`)),
      );
    case 'ocrAll':
      return each(files, 'ilmpdf-ocr.zip', 'searchable PDFs', onProgress, async (f, step) => {
        const { bytes, read, words } = await ocrBytes(copyBytes(f.bytes), (done, all) => step(`page ${done} of ${all}`));
        if (read === 0) throw new Error('every page already has text');
        if (words === 0) throw new Error('no words were recognised');
        return [{ name: safeFileName(f.name, '-ocr'), bytes: bytes! }];
      });
  }
}

async function merge(files: PdfFile[]): Promise<string> {
  const out = await runPdfJob({ op: 'merge', files: files.map((f) => copyBytes(f.bytes)) });
  saveBytes(out.files![0]!, 'merged.pdf');
  const pages = files.reduce((sum, f) => sum + f.pages, 0);
  return `Merged ${plural(files.length, 'PDF')} (${plural(pages, 'page')}) in the order they were dragged, and saved merged.pdf.`;
}

/** Compress all and Clean all reuse Batch, so they get its ZIP and its report. */
async function batch(files: PdfFile[], action: BatchAction, alsoClean: boolean, onProgress: QuickProgress): Promise<string> {
  const results = await runBatch(files, action, alsoClean, (i) => onProgress(`File ${Math.min(i + 2, files.length)} of ${files.length}`));
  const zip = batchZip(action.kind, results);
  const failed = results.filter((r) => !r.output);
  if (!zip) throw new Error(`None of the files could be processed. ${failed.map((r) => `${r.source}: ${r.error}`).join(' ')}`);
  const name = zipName(action.kind);
  saveBytes(zip, name, 'application/zip');
  return `Saved ${plural(files.length - failed.length, 'PDF')} in ${name}, with a report inside.${skipped(failed.map((r) => ({ name: r.source, reason: r.error ?? '' })))}`;
}

/** Runs `work` on each file and saves everything it returns in one ZIP. */
async function each(
  files: PdfFile[],
  zipFile: string,
  what: string,
  onProgress: QuickProgress,
  work: (file: PdfFile, step: (text: string) => void) => Promise<ZipEntry[]>,
): Promise<string> {
  const entries: ZipEntry[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const [i, file] of files.entries()) {
    const step = (text: string) => onProgress(`File ${i + 1} of ${files.length}${text ? `, ${text}` : ''}`);
    step('');
    try {
      entries.push(...(await work(file, step)));
    } catch (err) {
      failed.push({ name: file.name, reason: err instanceof Error ? err.message : 'something went wrong' });
    }
  }
  if (entries.length === 0) throw new Error(`Nothing was saved.${skipped(failed)}`);
  const names = uniqueNames(entries.map((e) => e.name));
  saveBytes(makeZip(entries.map((e, i) => ({ name: names[i]!, bytes: e.bytes }))), zipFile, 'application/zip');
  return `Saved ${plural(entries.length, what.replace(/s$/, ''), what)} in ${zipFile}.${skipped(failed)}`;
}

/** File names come from the user's disk, so they are shown as plain text only (never as markup). */
const skipped = (failed: { name: string; reason: string }[]) =>
  failed.length ? ` Skipped ${failed.map((f) => `${f.name} (${f.reason})`).join(', ')}.` : '';

// ---------------------------------------------------------------- images

/** Turns dropped images into one PDF, one image per page, in the order they were dragged. */
export async function runImages(id: ImagesId, images: ImageFile[], onProgress: QuickProgress = () => {}): Promise<string> {
  const out = await runPdfJob({
    op: 'imagesToPdf',
    images: images.map((i) => ({ bytes: copyBytes(i.bytes), kind: i.kind })),
    size: id === 'imgFit' ? 'fit' : 'a4',
    margin: 0,
  });
  const pdf = out.files![0]!;
  if (id !== 'imgOcr') {
    saveBytes(pdf, 'images.pdf');
    return `Made a ${images.length}-page PDF and saved images.pdf.`;
  }
  // OCR gets its own copy, which is moved into its worker; `pdf` stays here.
  const { bytes, words } = await ocrBytes(pdf.slice(), (done, total) => onProgress(`Reading page ${done} of ${total}`));
  if (!bytes || words === 0) {
    // Keep the PDF anyway: the user asked for one, OCR only adds to it.
    saveBytes(pdf, 'images.pdf');
    return `No words were recognised, so images.pdf was saved without searchable text (${plural(images.length, 'page')}).`;
  }
  saveBytes(bytes, 'images-ocr.pdf');
  return `Made a searchable ${images.length}-page PDF (${plural(words, 'word')} recognised) and saved images-ocr.pdf.`;
}
