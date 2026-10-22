// What each Drag Wheel slice does. Every action uses the same engines and
// defaults as its full tool (each job in its own fresh worker), saves a new
// file through a normal download, and returns a sentence for the result note.
import type { PdfFile } from './files';
import type { QuickId } from './wheel';
import { copyBytes, runMupdfJob, runOcrJob, runPdfJob } from './orchestrator';
import { describeRemoved, removeScripts } from './clean';
import { saveBytes } from './save';
import { formatBytes, safeFileName } from './validate';
import { makeZip } from './zip';
import { closePdf, openPdf, pageToImage } from '../engines/pdfjs';

/** Same resolution as the PDF to images tool's default. */
const IMAGE_DPI = 150;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short "doing it" text shown on the wheel while the job runs. */
export const BUSY_TEXT: Record<QuickId, string> = {
  compress: 'Compressing',
  png: 'Making PNGs',
  jpg: 'Making JPGs',
  text: 'Reading text',
  ocr: 'Recognising text',
  clean: 'Cleaning',
  flatten: 'Flattening',
};

export type QuickProgress = (text: string) => void;

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

// One page is saved as a single image; more pages go into one ZIP, because
// Safari asks before letting a page start many downloads at once.
async function images(file: PdfFile, id: 'png' | 'jpg', onProgress: QuickProgress): Promise<string> {
  const format = id === 'png' ? 'image/png' : 'image/jpeg';
  const base = safeFileName(file.name, '', '');
  const doc = await openPdf(file.bytes);
  try {
    const count = doc.numPages;
    const entries: { name: string; bytes: Uint8Array }[] = [];
    for (let n = 1; n <= count; n++) {
      onProgress(`Page ${n} of ${count}`);
      const blob = await pageToImage(doc, n, format, IMAGE_DPI);
      entries.push({ name: `${base}-page-${n}.${id}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (entries.length === 1) {
      saveBytes(entries[0]!.bytes, entries[0]!.name, format);
      return `Saved ${entries[0]!.name}.`;
    }
    const name = `${base}-pages-${id}.zip`;
    saveBytes(makeZip(entries), name, 'application/zip');
    return `Saved ${plural(entries.length, 'page')} as ${id.toUpperCase()} images in ${name}.`;
  } finally {
    await closePdf(doc);
  }
}

async function text(file: PdfFile): Promise<string> {
  const out = await runMupdfJob({ op: 'extractText', file: copyBytes(file.bytes) });
  const { pages, chars } = out.text!;
  if (chars === 0) return 'No text was found, so nothing was saved. This PDF is probably scanned: try the OCR slice first.';
  const name = safeFileName(file.name, '', '.txt');
  // Same layout as the PDF to text tool with "mark pages" on.
  const body = pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n');
  saveBytes(new Blob([`${body}\n`], { type: 'text/plain;charset=utf-8' }), name);
  return `Saved the text of ${plural(pages.length, 'page')} as ${name}.`;
}

async function ocr(file: PdfFile, onProgress: QuickProgress): Promise<string> {
  const out = await runOcrJob(
    { op: 'ocr', file: copyBytes(file.bytes), pages: [], skipText: true },
    { onProgress: (done, total) => onProgress(`Page ${done} of ${total}`) },
  );
  const read = Number(out.meta?.read ?? 0);
  const words = out.count ?? 0;
  if (read === 0) return 'Every page already has text, so there was nothing to read. Nothing was saved.';
  if (words === 0) return `No words were recognised on ${plural(read, 'page')}, so nothing was saved.`;
  const name = safeFileName(file.name, '-ocr');
  saveBytes(out.files![0]!, name);
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
