import { MAX_FILE_BYTES } from './limits';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// The PDF spec allows the header anywhere in the first 1024 bytes.
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
  for (let i = 0; i <= end; i++) {
    if (PDF_MAGIC.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

export type FileCheck = { ok: true } | { ok: false; reason: string };

export function checkFileMeta(name: string, size: number): FileCheck {
  if (!name.toLowerCase().endsWith('.pdf')) return { ok: false, reason: 'Not a .pdf file' };
  if (size === 0) return { ok: false, reason: 'File is empty' };
  if (size > MAX_FILE_BYTES) return { ok: false, reason: 'File is larger than 500 MB' };
  return { ok: true };
}

// Output names are built from user file names; keep them plain and short.
export function safeFileName(name: string, suffix = ''): string {
  const base = name.replace(/\.pdf$/i, '');
  const cleaned = base
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return `${cleaned || 'document'}${suffix}.pdf`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
