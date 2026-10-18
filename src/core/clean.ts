// The "Also remove scripts" option shared by the tools that save a PDF. It
// runs the Remove scripts engine (sanitize() in mupdf-ops) on each file a
// tool produced, each in its own fresh MuPDF worker, just before saving.
import type { SanitizeReport } from '../engines/mupdf-ops';
import { runMupdfJob } from './orchestrator';

export type Cleaned = { files: Uint8Array[]; removed: SanitizeReport };

const empty = (): SanitizeReport => ({ scripts: 0, autoActions: 0, openers: 0, dataActions: 0, attachments: 0, xfa: 0 });

/**
 * Removes scripts and attached files from each file. A file with nothing to
 * remove is returned unchanged. The files passed in are moved into the
 * workers, so callers must not use them afterwards.
 */
export async function removeScripts(files: Uint8Array[]): Promise<Cleaned> {
  const removed = empty();
  const out: Uint8Array[] = [];
  // One after another: each job loads a full copy of MuPDF.
  for (const file of files) {
    const keep = file.slice();
    const result = await runMupdfJob({ op: 'sanitize', file });
    out.push(result.files?.[0] ?? keep);
    for (const key of Object.keys(removed) as (keyof SanitizeReport)[]) removed[key] += result.removed?.[key] ?? 0;
  }
  return { files: out, removed };
}

/**
 * What tools call just before saving: when the option is ticked, cleans the
 * files and returns a sentence to add to the result message. When it is not
 * ticked, the files come back as they are and the sentence is empty.
 */
export async function cleanIf(on: boolean, files: Uint8Array[]): Promise<{ files: Uint8Array[]; note: string }> {
  if (!on) return { files, note: '' };
  const cleaned = await removeScripts(files);
  return { files: cleaned.files, note: cleanNote(cleaned.removed) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Turns the counts into a short list such as "2 scripts, 1 attached file". */
export function describeRemoved(r: SanitizeReport): string {
  const parts = [
    r.scripts && plural(r.scripts, 'script', 'scripts'),
    r.autoActions && plural(r.autoActions, 'automatic action', 'automatic actions'),
    r.openers && plural(r.openers, 'action that opens programs or other files', 'actions that open programs or other files'),
    r.dataActions && plural(r.dataActions, 'form action that sends or loads data', 'form actions that send or load data'),
    r.attachments && plural(r.attachments, 'attached file', 'attached files'),
    r.xfa && 'an XFA form layer',
  ].filter(Boolean);
  return parts.join(', ');
}

/** The sentence added to a tool's result message when the option was ticked. */
export function cleanNote(removed: SanitizeReport): string {
  const list = describeRemoved(removed);
  return list ? ` Also removed ${list}.` : ' No scripts or attached files were found.';
}
