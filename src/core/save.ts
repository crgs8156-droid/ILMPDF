import { shelf } from './shelf.svelte';

// Saving works through a normal download, which Safari supports everywhere.
// Every result is also listed under Saved files (memory only, this tab).
export function saveBytes(bytes: Uint8Array | Blob, fileName: string, type = 'application/pdf'): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  download(blob, fileName);
  shelf.addSaved(blob, fileName);
}

/** Starts the download. The object URL is revoked right after the click so it does not linger. */
export function download(blob: Blob, fileName: string): void {
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
