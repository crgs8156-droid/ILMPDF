/// <reference lib="webworker" />
// Runs MuPDF (WebAssembly) on untrusted PDFs, isolated from the page. A fresh
// worker is created for every job and terminated when it finishes.
import { loadMupdf } from './load-mupdf';
import type { JobResult, MupdfJob, MupdfRequest, JobOutput } from '../core/jobs';
import { UserFacingError } from '../engines/pdflib-ops';
import * as ops from '../engines/mupdf-ops';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function run(job: MupdfJob): Promise<JobOutput> {
  const mupdf = await loadMupdf();
  switch (job.op) {
    case 'inspect':
      return { info: ops.inspect(mupdf, job.file) };
    case 'unlock':
      return { files: [ops.unlock(mupdf, job.file, job.password)] };
    case 'protect':
      return { files: [ops.protect(mupdf, job.file, job.opts)] };
    case 'repair': {
      const { file, pages, repaired } = ops.repair(mupdf, job.file);
      return { files: [file], count: pages, repaired };
    }
    case 'compress': {
      const { file, before, after, images } = ops.compress(mupdf, job.file, job.level);
      return { files: [file], sizes: { before, after, images } };
    }
    case 'readForm':
      return { fields: ops.readForm(mupdf, job.file) };
    case 'fillForm':
      return { files: [ops.fillForm(mupdf, job.file, job.values, job.flatten)] };
    case 'extractText':
      return { text: ops.extractText(mupdf, job.file) };
    case 'annotate':
      return { files: [ops.annotate(mupdf, job.file, job.items)] };
    case 'findText': {
      const { boxes, fields } = ops.findText(mupdf, job.file, job.text);
      return { boxes, count: fields };
    }
    case 'redact': {
      const { file, boxes, pages, bookmarks, attachments, unchecked } = ops.redact(mupdf, job.file, job.boxes, job.options);
      return {
        files: [file],
        count: boxes,
        meta: { pages: String(pages), bookmarks: String(bookmarks), attachments: String(attachments) },
        unchecked,
      };
    }
    case 'sanitize': {
      const { file, report } = ops.sanitize(mupdf, job.file);
      return { files: file ? [file] : [], removed: report };
    }
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
