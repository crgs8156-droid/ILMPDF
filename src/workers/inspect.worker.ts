/// <reference lib="webworker" />
// Phase 0 test worker: proves the file path every tool will use.
// It checks the PDF header and hands the same buffer straight back.
import type { JobRequest, JobResult } from '../core/jobs';
import { hasPdfHeader } from '../core/validate';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<JobRequest>) => {
  const { id, buffer } = event.data;
  try {
    const isPdf = hasPdfHeader(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024)));
    const result: JobResult = { id, ok: true, buffer, isPdf, bytes: buffer.byteLength };
    ctx.postMessage(result, [buffer]);
  } catch (err) {
    const result: JobResult = { id, ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
    ctx.postMessage(result);
  }
};
