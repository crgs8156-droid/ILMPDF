import { checkFileMeta, hasPdfHeader } from './validate';
import { MAX_FILES } from './limits';
import { copyBytes, runPdfJob } from './orchestrator';
import { shelf } from './shelf.svelte';

export type PdfFile = { key: string; name: string; size: number; bytes: Uint8Array; pages: number };
export type Rejected = { name: string; reason: string };

/** Reads, checks and counts pages of user-chosen PDFs. Nothing leaves the device. */
export async function loadPdfs(files: File[], room = MAX_FILES): Promise<{ ok: PdfFile[]; rejected: Rejected[] }> {
  const ok: PdfFile[] = [];
  const rejected: Rejected[] = [];
  const tool = shelf.tool;
  for (const file of files.slice(0, Math.max(0, room))) {
    const meta = checkFileMeta(file.name, file.size);
    if (!meta.ok) {
      rejected.push({ name: file.name, reason: meta.reason });
      continue;
    }
    const checked = await checkPdf(file.name, new Uint8Array(await file.arrayBuffer()));
    if ('reason' in checked) {
      rejected.push(checked);
      continue;
    }
    ok.push(checked);
    // Also listed under Your files and Recent files (memory only, this tab).
    shelf.add(checked, tool);
  }
  for (const extra of files.slice(Math.max(0, room))) {
    rejected.push({ name: extra.name, reason: `Limit of ${MAX_FILES} files reached` });
  }
  return { ok, rejected };
}

/**
 * The checks every PDF goes through before a tool sees it, whether you
 * dropped it or it is a result you continue with: size limits, a real PDF
 * header, and a page count read in a fresh worker (so a hostile file can
 * only break that worker).
 */
export async function checkPdf(name: string, bytes: Uint8Array): Promise<PdfFile | Rejected> {
  const meta = checkFileMeta(name, bytes.length);
  if (!meta.ok) return { name, reason: meta.reason };
  if (!hasPdfHeader(bytes.subarray(0, 1024))) return { name, reason: 'Not a real PDF (header missing)' };
  try {
    const { count } = await runPdfJob({ op: 'pageCount', file: copyBytes(bytes) });
    return { key: crypto.randomUUID(), name, size: bytes.length, bytes, pages: count ?? 0 };
  } catch (err) {
    return { name, reason: err instanceof Error ? err.message : 'Could not read' };
  }
}

/**
 * "Continue with this file": puts a saved result on Your files and opens it
 * in `tool`. Returns why it could not, or null when the tool is opening.
 */
export async function continueWith(savedId: number, tool: string): Promise<string | null> {
  const saved = shelf.saved.find((s) => s.id === savedId);
  if (!saved) return 'That result was cleared from memory. Save it again from the tool.';
  const checked = await checkPdf(saved.name, new Uint8Array(await saved.blob.arrayBuffer()));
  if ('reason' in checked) return `${checked.name}: ${checked.reason}`;
  const entry = shelf.add(checked, null);
  shelf.openIn(entry.id, tool);
  return null;
}

export type ImageFile = { key: string; name: string; size: number; bytes: Uint8Array; kind: 'jpg' | 'png' };

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

/** JPG and PNG are used as-is; other formats Safari can decode (HEIC, WebP, GIF) become JPG. */
export async function loadImages(files: File[]): Promise<{ ok: ImageFile[]; rejected: Rejected[] }> {
  const ok: ImageFile[] = [];
  const rejected: Rejected[] = [];
  for (const file of files.slice(0, 200)) {
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      rejected.push({ name: file.name, reason: 'Image is empty or larger than 100 MB' });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (kind) {
      ok.push({ key: crypto.randomUUID(), name: file.name, size: file.size, bytes, kind });
      continue;
    }
    try {
      const jpg = await reencodeAsJpeg(file);
      ok.push({ key: crypto.randomUUID(), name: file.name, size: jpg.length, bytes: jpg, kind: 'jpg' });
    } catch {
      rejected.push({ name: file.name, reason: 'Not an image this browser can read' });
    }
  }
  return { ok, rejected };
}

function sniffImage(b: Uint8Array): 'jpg' | 'png' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

async function reencodeAsJpeg(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('encode failed');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** Moves one item in a list, returning a new list. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
