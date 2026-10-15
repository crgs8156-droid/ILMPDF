# 2026-10-15: Stack and security baseline

## Decision

- Static web app: TypeScript (strict), Vite 8, Svelte 5. No backend.
- Runs on loopback (`127.0.0.1`) and is added to the Dock from Safari.
- Primary browser: Safari (WebKit). Chromium is tested as a second engine.
- AGPL engines (MuPDF, Ghostscript) are allowed for personal use only.
  ILMPDF must not be shared or hosted for others unless its source is released under AGPL.
- Office (Word/Excel/PowerPoint) conversion is out of scope for now.
- Target machine: MacBook Air M4, 16 GB RAM.

## Security baseline (Phase 0)

- Production CSP: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`,
  `connect-src 'none'`, `object-src`/`base-uri`/`form-action`/`frame-src`/`frame-ancestors 'none'`.
  Also emitted as a `<meta>` tag in the built `index.html`.
- COOP `same-origin` + COEP `require-corp` (cross-origin isolation, also enables
  multi-threaded WASM later), CORP `same-origin`, `Referrer-Policy: no-referrer`,
  restrictive `Permissions-Policy`, `nosniff`.
- Dev server only relaxes CSP for Vite's hot reload (websocket to itself, inline styles).
- Each job runs in a fresh Web Worker that is terminated afterwards; buffers are transferred, not copied.
- Limits: 500 MB per file, 50 files, 60 s per job.

## Supply chain

- 9 direct dev dependencies, 66 packages in total; zero runtime dependencies in Phase 0.
- Exact pins, each version published at least 14 days before install.
- `ignore-scripts=true`: no package runs code at install time (none of the 66 declares one today).
- All lockfile entries resolve to registry.npmjs.org with sha512 integrity hashes.
- GitHub Actions pinned by commit SHA; CI has read-only permissions.
- `legacy-peer-deps=true` works around an npm 10 resolver crash; all peers are declared explicitly.

## Deferred

- Trusted Types: Svelte 5 builds DOM from template strings, which Trusted Types would block. Revisit later.
- Service worker / full offline PWA: Phase 4.
- ESLint/Prettier: left out to keep the dependency count small; `svelte-check` with strict TypeScript covers type safety.
