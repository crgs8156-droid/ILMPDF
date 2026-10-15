# Phase 2: MuPDF.js as the second engine

Date: 2026-10-15. Approved by the user: "yes use MuPDF.js alone".

## Choice

- **mupdf 1.28.1** (AGPL-3.0, Artifex Software) for unlock, protect (AES-256),
  repair, compress, forms and text. Zero dependencies, no install scripts,
  released 2026-09-06. AGPL is fine for personal use (decided in Phase 0
  planning); the app must not be published without its source.
- **No qpdf.** The qpdf WebAssembly packages on npm are small one-person
  builds, and MuPDF already covers passwords and repair.
- Redaction stays in Phase 3; annotations and text boxes moved to Phase 3.

## Keeping `connect-src 'none'`

MuPDF's Emscripten loader normally fetches `mupdf-wasm.wasm`. The MuPDF
worker (`src/workers/mupdf.worker.ts`) imports the .wasm as base64 through
the `?b64` plugin (also enabled for worker bundles in `vite.config.ts`) and
passes it as `wasmBinary` via `globalThis.$libmupdf_wasm_Module` before
importing `mupdf`. `locateFile` returns an empty data URL so nothing else
can be requested. The browser test `tests/e2e/mupdf-engine.spec.ts` starts
the built worker under the real CSP and fails on any network request,
any `.wasm` request, or any CSP violation.

Vite also copies the unused `mupdf-wasm.wasm` into `dist/assets` because
MuPDF's loader mentions it; it is never requested.

MuPDF's `import("node:fs")` and `module` imports only run under Node; in the
browser build Vite replaces them with empty stand-ins.

## Cost

The MuPDF worker is about 14 MB (the .wasm as base64). It is loaded only
when a Phase 2 tool runs, in a fresh worker that is terminated afterwards.
