// The file shelf: the PDFs you added, the results ILMPDF saved, and a list
// of what you did, for this tab only. Everything lives in memory (rule 7):
// nothing is written to browser storage or the disk, and a reload, closing
// the tab or "Clear all files" forgets it all.
import { nav } from './nav.svelte';
import { SHELF_LIMITS, sameBytes, trimNewestFirst } from './shelf-rules';
import type { PdfFile } from './files';

export type ShelfFile = PdfFile & { id: number; added: number };
export type SavedFile = { id: number; name: string; size: number; blob: Blob; tool: string | null; at: number };
export type Activity = { id: number; fileId: number; tool: string; at: number };

let nextId = 1;

class Shelf {
  files = $state.raw<ShelfFile[]>([]);
  saved = $state.raw<SavedFile[]>([]);
  recent = $state.raw<Activity[]>([]);
  /** A file chosen with "Open in…", waiting for that tool to open. */
  private pending: { tool: string; fileId: number } | null = null;

  /** The tool on screen now, if any. */
  get tool(): string | null {
    return nav.route.kind === 'tool' ? nav.route.id : null;
  }

  /**
   * Called by loadPdfs for every PDF it reads. `tool` is the tool that was
   * open when reading started (reading takes a moment, and you may have
   * moved on by the time it ends).
   */
  add(file: PdfFile, tool: string | null): ShelfFile {
    let entry = this.files.find((f) => f.name === file.name && sameBytes(f.bytes, file.bytes));
    if (!entry) entry = { ...file, id: nextId++, added: Date.now() };
    this.files = trimNewestFirst([entry, ...this.files.filter((f) => f.id !== entry.id)], SHELF_LIMITS.files.count, SHELF_LIMITS.files.bytes);
    if (tool) this.used(entry.id, tool);
    return entry;
  }

  /** Records that a file was used in a tool (newest first, one row per pair). */
  used(fileId: number, tool: string): void {
    const rest = this.recent.filter((r) => !(r.fileId === fileId && r.tool === tool));
    this.recent = [{ id: nextId++, fileId, tool, at: Date.now() }, ...rest].slice(0, SHELF_LIMITS.recent.count);
  }

  /** Called by saveBytes for every file ILMPDF saves. */
  addSaved(blob: Blob, name: string): void {
    const tool = this.tool;
    const entry: SavedFile = { id: nextId++, name, size: blob.size, blob, tool, at: Date.now() };
    this.saved = trimNewestFirst([entry, ...this.saved], SHELF_LIMITS.saved.count, SHELF_LIMITS.saved.bytes);
  }

  file(id: number): ShelfFile | undefined {
    return this.files.find((f) => f.id === id);
  }

  /** A copy for a tool to use: a fresh key, so the tool starts clean. */
  copyFor(id: number, tool: string): PdfFile | null {
    const f = this.file(id);
    if (!f) return null;
    this.used(f.id, tool);
    return { key: crypto.randomUUID(), name: f.name, size: f.size, bytes: f.bytes, pages: f.pages };
  }

  /** "Open in…": remembers the file and opens the tool, which picks it up. */
  openIn(fileId: number, tool: string): void {
    this.pending = { tool, fileId };
    nav.go({ kind: 'tool', id: tool, file: false });
  }

  /** The tool asks whether a file is waiting for it (once). */
  takePending(tool: string): PdfFile | null {
    const p = this.pending;
    this.pending = null;
    return p && p.tool === tool ? this.copyFor(p.fileId, tool) : null;
  }

  removeFile(id: number): void {
    this.files = this.files.filter((f) => f.id !== id);
    this.recent = this.recent.filter((r) => r.fileId !== id);
  }

  removeSaved(id: number): void {
    this.saved = this.saved.filter((s) => s.id !== id);
  }

  /** Forgets everything. The bytes are freed once no tool still shows them. */
  clear(): void {
    this.files = [];
    this.saved = [];
    this.recent = [];
    this.pending = null;
  }
}

export const shelf = new Shelf();
