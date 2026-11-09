import { makeZip, uniqueNames } from './zip';

// Saving works through a normal download, which Safari supports everywhere.
// The object URL is revoked right after the click so the bytes are released.
export function saveBytes(bytes: Uint8Array | Blob, fileName: string, type = 'application/pdf'): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One result of a tool that makes many files. `type` is its MIME type (PDF when left out). */
export type OutFile = { name: string; bytes: Uint8Array; type?: string };
export type Download = { name: string; bytes: Uint8Array | Blob; type: string };

/**
 * Decides what saveFiles() downloads, without touching the page, so unit tests
 * can check it: one ZIP when `asZip` is on and there is more than one file,
 * otherwise each file on its own. A single file is never zipped, because a
 * ZIP holding one file only adds a step for you.
 */
export function planDownloads(files: OutFile[], zipName: string, asZip: boolean): Download[] {
  if (asZip && files.length > 1) {
    // Names inside a ZIP must differ (ignoring case, like the Mac's disk).
    const names = uniqueNames(files.map((f) => f.name));
    const zip = makeZip(files.map((f, i) => ({ name: names[i]!, bytes: f.bytes })));
    return [{ name: zipName, bytes: zip, type: 'application/zip' }];
  }
  return files.map((f) => ({ name: f.name, bytes: f.bytes, type: f.type ?? 'application/pdf' }));
}

/**
 * Saves a tool's results: as one ZIP download (so Safari doesn't ask to allow
 * many downloads), or as separate files. Returns the ZIP's name when it made one.
 */
export function saveFiles(files: OutFile[], zipName: string, asZip: boolean): string | null {
  const downloads = planDownloads(files, zipName, asZip);
  for (const d of downloads) saveBytes(d.bytes, d.name, d.type);
  return downloads.length === 1 && downloads[0]!.type === 'application/zip' ? zipName : null;
}

/** " in name.zip" for a tool's done message, or "" when no ZIP was made. */
export const inZip = (zipName: string | null): string => (zipName ? ` in ${zipName}` : '');
