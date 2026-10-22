// Batch mode: runs one action over many PDFs and packs the results into one
// ZIP. It is a thin layer over the same worker jobs the single-file tools use,
// so each file still gets its own fresh worker that ends with the job. Files
// run one after another: every job loads a full copy of its engine, and
// running them side by side could exhaust Safari's memory.
import type { CompressLevel, ProtectOptions } from '../engines/mupdf-ops';
import type { NumberPosition } from '../engines/pdflib-ops';
import { cleanIf, removeScripts, describeRemoved } from './clean';
import { copyBytes, runMupdfJob, runPdfJob } from './orchestrator';
import { safeFileName } from './validate';
import { makeZip, uniqueNames, type ZipEntry } from './zip';

export type BatchAction =
  | { kind: 'compress'; level: CompressLevel }
  | { kind: 'watermark'; opts: { text: string; fontSize: number; opacity: number; diagonal: boolean } }
  | { kind: 'pageNumbers'; opts: { position: NumberPosition; startAt: number; fontSize: number; format: 'n' | 'n-of-total' } }
  | { kind: 'stripMetadata' }
  | { kind: 'sanitize' }
  | { kind: 'repair' }
  | { kind: 'protect'; opts: ProtectOptions }
  | { kind: 'unlock'; password: string };

export type BatchKind = BatchAction['kind'];

/** Label for the menu, and the suffix added to each result's name (as the single-file tools do). */
export const BATCH_ACTIONS: Record<BatchKind, { label: string; suffix: string }> = {
  compress: { label: 'Compress', suffix: '-compressed' },
  watermark: { label: 'Watermark', suffix: '-watermarked' },
  pageNumbers: { label: 'Page numbers', suffix: '-numbered' },
  stripMetadata: { label: 'Remove metadata', suffix: '-clean' },
  sanitize: { label: 'Remove scripts', suffix: '-clean' },
  repair: { label: 'Repair', suffix: '-repaired' },
  protect: { label: 'Protect with a password', suffix: '-protected' },
  unlock: { label: 'Unlock with a password', suffix: '-unlocked' },
};

/** Total size of the files picked for one batch; results are held in memory until the ZIP is saved. */
export const MAX_BATCH_BYTES = 1024 * 1024 * 1024;

export type BatchInput = { name: string; bytes: Uint8Array };
export type BatchResult = { source: string; output?: ZipEntry; note?: string; error?: string };

/**
 * Runs the action on one file and returns the new bytes plus an optional
 * remark for the report. `bytes` must be a private copy: it is moved into
 * the worker.
 */
async function processOne(action: BatchAction, bytes: Uint8Array, alsoClean: boolean): Promise<{ bytes: Uint8Array; note: string }> {
  const one = async (files: Uint8Array[] | undefined) => {
    const { files: [out], note } = await cleanIf(alsoClean, files!);
    return { bytes: out!, note: note.trim() };
  };
  switch (action.kind) {
    case 'compress': {
      const keep = bytes.slice();
      const out = await runMupdfJob({ op: 'compress', file: bytes, level: action.level });
      const { before, after } = out.sizes!;
      // Like the Compress tool, never hand back a bigger file: keep the original instead.
      if (after >= before) {
        const r = await one([keep]);
        return { bytes: r.bytes, note: `Already compact, so the original was kept. ${r.note}`.trim() };
      }
      const r = await one(out.files);
      return { bytes: r.bytes, note: `${pct(before, after)}% smaller. ${r.note}`.trim() };
    }
    case 'watermark':
      return one((await runPdfJob({ op: 'watermark', file: bytes, opts: action.opts })).files);
    case 'pageNumbers':
      return one((await runPdfJob({ op: 'pageNumbers', file: bytes, opts: action.opts })).files);
    case 'stripMetadata':
      return one((await runPdfJob({ op: 'stripMetadata', file: bytes })).files);
    case 'repair': {
      const out = await runMupdfJob({ op: 'repair', file: bytes });
      const r = await one(out.files);
      return { bytes: r.bytes, note: `${out.repaired ? 'Repaired.' : 'No damage found; rewritten cleanly.'} ${r.note}`.trim() };
    }
    case 'sanitize': {
      const keep = bytes.slice();
      const { files: [out], removed } = await removeScripts([bytes]);
      const found = describeRemoved(removed);
      return { bytes: out ?? keep, note: found ? `Removed ${found}.` : 'Nothing to remove.' };
    }
    case 'protect': {
      // Clean first: a locked file can't be opened to clean it.
      const { files: [source], note } = await cleanIf(alsoClean, [bytes]);
      const out = await runMupdfJob({ op: 'protect', file: source!, opts: action.opts });
      return { bytes: out.files![0]!, note: note.trim() };
    }
    case 'unlock':
      return one((await runMupdfJob({ op: 'unlock', file: bytes, password: action.password })).files);
  }
}

const pct = (before: number, after: number) => Math.round((1 - after / before) * 100);

/**
 * Processes every file. A file that fails is recorded with its reason and
 * the batch carries on. `onStep` reports progress after each file.
 */
export async function runBatch(
  files: BatchInput[],
  action: BatchAction,
  alsoClean: boolean,
  onStep: (index: number, result: BatchResult) => void = () => {},
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  const suffix = BATCH_ACTIONS[action.kind].suffix;
  for (const [i, file] of files.entries()) {
    let result: BatchResult;
    try {
      const { bytes, note } = await processOne(action, copyBytes(file.bytes), alsoClean && action.kind !== 'sanitize');
      result = { source: file.name, output: { name: safeFileName(file.name, suffix), bytes }, note };
    } catch (err) {
      result = { source: file.name, error: err instanceof Error ? err.message : 'Something went wrong.' };
    }
    results.push(result);
    onStep(i, result);
  }
  return results;
}

export const REPORT_NAME = 'ilmpdf-batch-report.txt';

/**
 * A plain-text summary that goes into the ZIP. File names come from the
 * user's disk, so control characters (such as line breaks that could fake
 * extra report lines) are replaced.
 */
export function batchReport(kind: BatchKind, results: BatchResult[], when = new Date()): string {
  const plain = (s: string) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '_');
  const ok = results.filter((r) => r.output);
  const failed = results.filter((r) => !r.output);
  const lines = [
    'ILMPDF batch report',
    `Action: ${BATCH_ACTIONS[kind].label}`,
    `Date: ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Done: ${ok.length} of ${results.length} files`,
    '',
  ];
  for (const r of ok) lines.push(`OK      ${plain(r.source)} -> ${plain(r.output!.name)}${r.note ? `  (${plain(r.note)})` : ''}`);
  for (const r of failed) lines.push(`FAILED  ${plain(r.source)}: ${plain(r.error ?? 'Unknown error')}`);
  lines.push('', 'Everything was processed on this Mac. No file left the device.', '');
  return lines.join('\n');
}

/** Packs the successful results and the report into one ZIP. Returns null when nothing worked. */
export function batchZip(kind: BatchKind, results: BatchResult[], when = new Date()): Blob | null {
  const outputs = results.flatMap((r) => (r.output ? [r.output] : []));
  if (outputs.length === 0) return null;
  const names = uniqueNames([...outputs.map((o) => o.name), REPORT_NAME]);
  const report = new TextEncoder().encode(batchReport(kind, results, when));
  const entries = [...outputs, { name: REPORT_NAME, bytes: report }].map((e, i) => ({ name: names[i]!, bytes: e.bytes }));
  return makeZip(entries, when);
}

export function zipName(kind: BatchKind): string {
  return `ilmpdf-batch${BATCH_ACTIONS[kind].suffix}.zip`;
}
