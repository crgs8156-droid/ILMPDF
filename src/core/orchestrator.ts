import type { JobRequest, JobResult } from './jobs';
import { JOB_TIMEOUT_MS } from './limits';

// Each job gets a fresh worker that is terminated as soon as the job ends,
// so a crash (or an exploit in a parser) dies with that one job.
export function runInspectJob(buffer: ArrayBuffer): Promise<Extract<JobResult, { ok: true }>> {
  const worker = new Worker(new URL('../workers/inspect.worker.ts', import.meta.url), {
    type: 'module',
    name: 'ilmpdf-inspect',
  });
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Job timed out'));
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
      finish();
      reject(new Error(event.message || 'Worker crashed'));
    };

    const request: JobRequest = { id, kind: 'inspect', buffer };
    worker.postMessage(request, [buffer]);
  });
}
