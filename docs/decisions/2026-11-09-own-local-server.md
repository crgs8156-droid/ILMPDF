# 2026-11-09: Our own local server instead of `vite preview`

**Decision (owner approved 2026-11-09, rule 2):** `npm run preview` and the
browser tests now use `scripts/serve.ts`, a small plain-Node server, instead
of Vite's preview server. The security headers themselves do not change.

## Why

- Vite's preview server is a large developer tool with features ILMPDF never
  uses, and Vite has had file-access security fixes before (PR #23).
- Our server is short enough to read in a few minutes and is fully tested.
- Vite left headers off 304 replies (worked around in `vite.config.ts`); our
  server puts them on every reply by design.

## What the server does

- Listens on 127.0.0.1:4173 only.
- GET and HEAD only; serves only files inside `dist/` of the types the build
  makes. `..` (plain or %-encoded), backslashes, dot files and symlinks that
  leave `dist/` are a 404.
- Refuses requests whose Host is not `127.0.0.1:4173` or `localhost:4173`
  (421), so a web page can't use DNS rebinding to read ILMPDF.
- Headers from `security-headers.ts` on every reply (200, 304, 404, 405, 421, 500).
- `Cache-Control: no-cache` with an ETag, so Safari picks up a rebuild at once.
- No network requests, no writes, no logging of paths. No new dependency.

## Checks

- `tests/unit/serve.test.ts`: hostile paths, wrong host, methods, headers on
  every kind of reply, HEAD.
- `tests/e2e/headers.spec.ts`: the real server, real build.
- `security-check.mjs`: "Our own server listens on 127.0.0.1 only" and the
  zero-egress scan now covers `scripts/serve.ts`.
- `tests/unit/security-headers.test.ts` pins the host, port and that
  `npm run preview` runs this server.

## Trade-offs

- Needs Node.js 22.18 or newer (Node runs the TypeScript file directly).
- `npm run dev` still uses Vite's dev server, for development only.
