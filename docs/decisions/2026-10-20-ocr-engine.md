# OCR engine: tesseract-wasm

Date: 2026-10-20. Approved by the owner in the "OCR research" thread
(research: `ilmpdf-plans/2026-10-18-ocr-research.md` in the project files).

## Decision

OCR uses **tesseract-wasm 0.11.0** (BSD-2-Clause, one dependency: comlink
4.4.2, Apache-2.0) with Tesseract's official **tessdata_fast English** model,
vendored in `vendor/tessdata/` with its SHA-256 recorded.

## Why

- MuPDF's WebAssembly build has no OCR.
- tesseract.js needs 9 dependencies (one with an install script) and by
  default downloads from a CDN and caches in IndexedDB.
- tesseract-wasm runs inside our own worker (`createOCREngine`), takes its
  `.wasm` and model as bytes, and never fetches anything when given both.

## How it works

`src/workers/ocr.worker.ts` bundles MuPDF, the Tesseract `.wasm` (SIMD build
only) and the model as base64. For each page, MuPDF draws it at 300 dpi,
Tesseract returns words with boxes, and `src/engines/ocr-layer.ts` writes them
with pdf-lib as invisible text (render mode 3) over the scan. Pages that
already have text are skipped by default. No CSP change was needed.

## Known limits

- English only; the hidden text uses Helvetica, so characters outside
  Western European Latin are dropped from the layer.
- The build also copies two unused tesseract-wasm files into `dist/assets`
  (`tesseract-worker-*.js`, `tesseract-core-*.wasm`), because the library
  mentions them for its own worker mode, which we don't use. The app never
  loads them.
- Single maintainer, last release 2025-10-24. Fallback if abandoned:
  tesseract.js, which uses the same models.
