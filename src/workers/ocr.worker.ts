/// <reference lib="webworker" />
// Runs OCR on untrusted PDFs, isolated from the page. A fresh worker is
// created for every job and terminated when it finishes.
//
// Like MuPDF's, Tesseract's .wasm and the English model are bundled into this
// worker as base64 and handed over as bytes, so nothing is ever fetched.
// Only the SIMD ("fast") build is bundled: every browser ILMPDF supports
// (Safari 16.4 and later, current Chrome) can run it.
import tesseractWasm from '../../node_modules/tesseract-wasm/dist/tesseract-core.wasm?b64';
import englishModel from '../../vendor/tessdata/eng.traineddata?b64';
import { createOCREngine, supportsFastBuild } from 'tesseract-wasm';
import type { JobResult, OcrProgressMessage, OcrRequest } from '../core/jobs';
import { UserFacingError } from '../engines/pdflib-ops';
import { ocr } from '../engines/ocr-ops';
import { base64ToBytes, loadMupdf } from './load-mupdf';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<OcrRequest>) => {
  const { id, job } = event.data;
  try {
    if (!supportsFastBuild()) throw new UserFacingError('OCR needs a newer browser (Safari 16.4 or later).');
    const mupdf = await loadMupdf();
    const engine = await createOCREngine({ wasmBinary: base64ToBytes(tesseractWasm) });
    engine.loadModel(base64ToBytes(englishModel));
    // Tesseract's default is to guess each picture's resolution and print
    // that guess; we always draw pages at 300 dpi, so tell it.
    engine.setVariable('user_defined_dpi', '300');
    const progress = (done: number, total: number) => {
      const message: OcrProgressMessage = { id, progress: { done, total } };
      ctx.postMessage(message);
    };
    const out = await ocr(mupdf, engine, job.file, { pages: job.pages, skipText: job.skipText }, progress);
    const result: JobResult = {
      id,
      ok: true,
      files: [out.file],
      count: out.words,
      meta: { read: String(out.read), skipped: String(out.skipped) },
    };
    ctx.postMessage(result, [out.file.buffer as ArrayBuffer]);
  } catch (err) {
    const error = err instanceof UserFacingError ? err.message : 'Something went wrong while reading this PDF.';
    const result: JobResult = { id, ok: false, error };
    ctx.postMessage(result);
  }
};
