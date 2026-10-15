/// <reference lib="webworker" />
// Runs MuPDF (WebAssembly) on untrusted PDFs, isolated from the page. A fresh
// worker is created for every job and terminated when it finishes.
//
// MuPDF normally downloads its .wasm file at startup, which our CSP blocks
// (connect-src 'none'). Instead the .wasm is bundled into this worker as
// base64 and handed to MuPDF through Emscripten's documented `wasmBinary`
// option, so nothing is ever fetched.
import wasmBase64 from '../../node_modules/mupdf/dist/mupdf-wasm.wasm?b64';
import type { JobResult, MupdfJob, MupdfRequest, JobOutput } from '../core/jobs';
import { UserFacingError } from '../engines/pdflib-ops';
import * as ops from '../engines/mupdf-ops';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadMupdf() {
  (globalThis as Record<string, unknown>)['$libmupdf_wasm_Module'] = {
    wasmBinary: base64ToBytes(wasmBase64),
    // If MuPDF ever asks for a file URL anyway, give it nothing useful.
    locateFile: () => 'data:,',
  };
  return import('mupdf');
}

async function run(job: MupdfJob): Promise<JobOutput> {
  const mupdf = await loadMupdf();
  switch (job.op) {
    case 'inspect':
      return { info: ops.inspect(mupdf, job.file) };
    case 'unlock':
      return { files: [ops.unlock(mupdf, job.file, job.password)] };
    case 'protect':
      return { files: [ops.protect(mupdf, job.file, job.opts)] };
  }
}

ctx.onmessage = async (event: MessageEvent<MupdfRequest>) => {
  const { id, job } = event.data;
  try {
    const output = await run(job);
    const result: JobResult = { id, ok: true, ...output };
    ctx.postMessage(result, (output.files ?? []).map((f) => f.buffer as ArrayBuffer));
  } catch (err) {
    const error = err instanceof UserFacingError ? err.message : 'Something went wrong while processing this PDF.';
    const result: JobResult = { id, ok: false, error };
    ctx.postMessage(result);
  }
};
