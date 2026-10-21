/// <reference lib="webworker" />
// Runs pdf-lib on untrusted PDFs, isolated from the page. A fresh worker is
// created for every job and terminated when it finishes.
import type { JobOutput, JobRequest, JobResult, PdfJob } from '../core/jobs';
import * as ops from '../engines/pdflib-ops';
import { addHeaderFooter } from '../engines/header-footer';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function run(job: PdfJob): Promise<JobOutput> {
  switch (job.op) {
    case 'pageCount':
      return { count: await ops.pageCount(job.file) };
    case 'merge':
      return { files: [await ops.merge(job.files)] };
    case 'pick':
      return { files: await ops.pick(job.file, job.groups) };
    case 'organize':
      return { files: [await ops.organize(job.file, job.plan)] };
    case 'imagesToPdf':
      return { files: [await ops.imagesToPdf(job.images, job.size, job.margin)] };
    case 'pageNumbers':
      return { files: [await ops.addPageNumbers(job.file, job.opts)] };
    case 'watermark':
      return { files: [await ops.addWatermark(job.file, job.opts)] };
    case 'readMetadata':
      return { meta: await ops.readMetadata(job.file) };
    case 'stripMetadata':
      return { files: [await ops.stripMetadata(job.file)] };
    case 'sign':
      return { files: [await ops.addSignature(job.file, job.image, job.placements)] };
    case 'crop':
      return { files: [await ops.cropPages(job.file, job.box, job.pages)] };
    case 'headerFooter':
      return { files: [await addHeaderFooter(job.file, job.opts)] };
  }
}

ctx.onmessage = async (event: MessageEvent<JobRequest>) => {
  const { id, job } = event.data;
  try {
    const output = await run(job);
    const result: JobResult = { id, ok: true, ...output };
    ctx.postMessage(result, (output.files ?? []).map((f) => f.buffer as ArrayBuffer));
  } catch (err) {
    // Only messages we wrote ourselves reach the UI; library internals stay here.
    const error = err instanceof ops.UserFacingError ? err.message : 'Something went wrong while processing this PDF.';
    const result: JobResult = { id, ok: false, error };
    ctx.postMessage(result);
  }
};
