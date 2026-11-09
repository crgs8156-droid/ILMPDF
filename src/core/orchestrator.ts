import type { JobOutput, JobResult, MupdfJob, OcrJob, OcrProgressMessage, PdfJob } from './jobs';
import { JOB_TIMEOUT_MS, OCR_PAGE_TIMEOUT_MS } from './limits';

// Jobs running right now, and when the last one ended. Auto-clear
// (core/idle.svelte.ts) never clears during a job, and counts a job
// ending as use, so a long OCR doesn't clear the moment it finishes.
let running = 0;
let lastEnd = 0;
export function jobActivity(): { running: number; lastEnd: number } {
  return { running, lastEnd };
}
function tracked<T>(job: Promise<T>): Promise<T> {
  running++;
  return job.finally(() => {
    running--;
    lastEnd = Date.now();
  });
}

// Each job gets a fresh worker that is terminated as soon as the job ends,
// so a crash (or an exploit in a parser) dies with that one job.
export type JobOptions = {
  /** Aborting (the tool's Cancel button) ends the worker at once; nothing is saved. */
  signal?: AbortSignal | undefined;
};

/** The error a job rejects with when it was cancelled. */
export const CANCELLED = 'Cancelled. Nothing was saved.';

export function runPdfJob(job: PdfJob, opts: JobOptions = {}): Promise<JobOutput> {
  // Vite needs the literal `new URL(...)` here to bundle the worker.
  const worker = new Worker(new URL('../workers/pdflib.worker.ts', import.meta.url), {
    type: 'module',
    name: 'ilmpdf-pdflib',
  });
  return runInWorker(worker, job, opts.signal);
}

/** Same as runPdfJob, but on the MuPDF engine (passwords, repair, compress). */
export function runMupdfJob(job: MupdfJob, opts: JobOptions = {}): Promise<JobOutput> {
  const worker = new Worker(new URL('../workers/mupdf.worker.ts', import.meta.url), {
    type: 'module',
    name: 'ilmpdf-mupdf',
  });
  return runInWorker(worker, job, opts.signal);
}

export type OcrRunOptions = JobOptions & {
  onProgress?: (done: number, total: number) => void;
};

/**
 * Runs OCR in its own fresh worker. A long scan can take minutes, so instead
 * of one time limit for the whole job, each page must finish within
 * OCR_PAGE_TIMEOUT_MS of the one before.
 */
export function runOcrJob(job: OcrJob, opts: OcrRunOptions = {}): Promise<JobOutput> {
  const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
    type: 'module',
    name: 'ilmpdf-ocr',
  });
  const id = crypto.randomUUID();

  return tracked(new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const watchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish();
        reject(new Error('OCR took too long on one page and was stopped.'));
      }, OCR_PAGE_TIMEOUT_MS);
    };
    const cancel = () => {
      finish();
      reject(new Error(CANCELLED));
    };
    if (opts.signal?.aborted) return cancel();
    opts.signal?.addEventListener('abort', cancel);
    watchdog();

    worker.onmessage = (event: MessageEvent<JobResult | OcrProgressMessage>) => {
      const data = event.data;
      if (data.id !== id) {
        finish();
        return reject(new Error('Mismatched job result'));
      }
      if ('progress' in data) {
        watchdog();
        return opts.onProgress?.(data.progress.done, data.progress.total);
      }
      finish();
      if (data.ok) resolve(data);
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(new Error('The OCR engine stopped unexpectedly.'));
    };

    worker.postMessage({ id, job }, [job.file.buffer as ArrayBuffer]);
  }));
}

function runInWorker(worker: Worker, job: PdfJob | MupdfJob, signal?: AbortSignal): Promise<JobOutput> {
  const id = crypto.randomUUID();

  return tracked(new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish();
      reject(new Error('This job took too long and was stopped.'));
    }, JOB_TIMEOUT_MS);

    // terminate() ends the worker straight away, even in the middle of a
    // WebAssembly call, and frees its memory (engine and file copy).
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(new Error(CANCELLED));
    };
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel);

    worker.onmessage = (event: MessageEvent<JobResult>) => {
      finish();
      const result = event.data;
      if (result.id !== id) return reject(new Error('Mismatched job result'));
      if (result.ok) resolve(result);
      else reject(new Error(result.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(new Error('The PDF engine stopped unexpectedly.'));
    };

    worker.postMessage({ id, job }, transferables(job));
  }));
}

// Every byte array in a job is a private copy, so it can be moved.
function transferables(job: PdfJob | MupdfJob): ArrayBuffer[] {
  const arrays: Uint8Array[] = [];
  if ('file' in job) arrays.push(job.file);
  if ('files' in job) arrays.push(...job.files);
  if ('images' in job) arrays.push(...job.images.map((i) => i.bytes));
  if ('image' in job) arrays.push(job.image.bytes);
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}

/** A private copy of stored bytes for one job. */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}
