# Phase 1: PDF engines and how they stay offline

Date: 2026-10-15. Approved by the user ("pdf-lib the original").

## Choices

- **pdf-lib 1.17.1** (MIT) edits PDFs: merge, split, organize, images to PDF,
  page numbers, watermark, metadata. Chosen over the `@cantoo/pdf-lib` fork
  because the original has far more users and a long, stable history. It is
  unmaintained since 2021, so password support will come from a separate
  engine in Phase 2. Its 4 dependencies (pako, tslib, @pdf-lib/standard-fonts,
  @pdf-lib/upng) have no install scripts and no `eval`.
- **pdfjs-dist 6.3.289** (Apache-2.0, Mozilla) renders thumbnails and PDF to
  images. We import the **legacy build** (`pdfjs-dist/legacy/build/`): the
  modern build calls `Map.prototype.getOrInsertComputed`, which current
  Chrome and Safari may not have yet. The legacy build is the same code with
  polyfills. Its one `Function('return this')` is a fallback that runs only
  when `globalThis` is missing, and the CSP would block it anyway.

## Keeping `connect-src 'none'`

PDF.js normally downloads fonts, character maps and image decoders (wasm) at
run time. Instead, a small Vite plugin in `vite.config.ts` turns
`?b64` imports into base64 modules, and `src/engines/pdfjs.ts` hands them to
PDF.js through a custom `BinaryDataFactory` with `useWorkerFetch: false`.
The URLs passed to PDF.js are the placeholder `bundled:/`, never real ones.
PDF.js scripting (QuickJS) and XFA forms are not bundled or enabled.

## Optional native package refused

PDF.js lists `@napi-rs/canvas` (a native binary for Node) as optional. We
never want a prebuilt binary on the Mac, so `package.json` points it at an
empty local stub in `vendor/stubs/napi-rs-canvas` via `overrides`.

## Safety nets

- Every job runs in a new Web Worker that is terminated afterwards; the UI
  only sends copies of the file bytes.
- Only friendly, known error messages reach the screen.
- Limits in `src/core/limits.ts`: 500 MB per file, 50 files, 5000 pages,
  5 minutes per job, 40 megapixels per exported image.
- Browser tests fail if any request leaves `http://127.0.0.1:4173`.
