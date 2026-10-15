import type { JobOutput, JobRequest, JobResult, PdfJob } from './jobs';
import { JOB_TIMEOUT_MS } from './limits';

// Each job gets a fresh worker that is terminated as soon as the job ends,
// so a crash (or an exploit in a parser) dies with that one job.
export function runPdfJob(job: PdfJob): Promise<JobOutput> {
  const worker = new Worker(new URL('../workers/pdflib.worker.ts', import.meta.url), {
    type: 'module',
    name: 'ilmpdf-pdflib',
  });
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('This job took too long and was stopped.'));
    }, JOB_TIMEOUT_MS);

    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };

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

    const request: JobRequest = { id, job };
    worker.postMessage(request, transferables(job));
  });
}

// Every byte array in a job is a private copy, so it can be moved.
function transferables(job: PdfJob): ArrayBuffer[] {
  const arrays: Uint8Array[] = [];
  if ('file' in job) arrays.push(job.file);
  if ('files' in job) arrays.push(...job.files);
  if ('images' in job) arrays.push(...job.images.map((i) => i.bytes));
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}

/** A private copy of stored bytes for one job. */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}
