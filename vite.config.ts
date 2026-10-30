/// <reference types="vitest/config" />
import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { PROD_CSP, devHeaders, prodHeaders } from './security-headers.ts';

// Loopback only: ILMPDF must never be reachable from other devices.
const HOST = '127.0.0.1';
const DEV_PORT = 5173;
const PREVIEW_PORT = 4173;

// Defence in depth: the built index.html also carries the strict CSP as a
// <meta> tag, so it still applies if the files are served some other way.
// (frame-ancestors is header-only, so it is dropped from the meta copy.)
function cspMetaTag(): Plugin {
  const metaCsp = PROD_CSP.split('; ')
    .filter((d) => !d.startsWith('frame-ancestors'))
    .join('; ');
  return {
    name: 'ilmpdf-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />`,
      );
    },
  };
}

// Turns `file?b64` imports into a JS module holding the file as base64.
// Used for PDF.js fonts, character maps and decoders, so the app never has
// to fetch them (the CSP blocks all fetches).
function inlineBinary(): Plugin {
  return {
    name: 'ilmpdf-inline-binary',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('?b64')) return null;
      const data = await readFile(id.slice(0, -'?b64'.length));
      return `export default ${JSON.stringify(data.toString('base64'))};`;
    },
  };
}

// Vite's own `headers` option skips "304 Not Modified" replies. Safari then
// treats a revalidated worker script as having no COEP header and refuses to
// start it, so the second PDF job of a session hangs. Setting the headers
// in a middleware puts them on every reply, 304s included.
function securityHeaders(): Plugin {
  const apply = (headers: Record<string, string>) => (_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    next();
  };
  return {
    name: 'ilmpdf-security-headers',
    configureServer(server) {
      server.middlewares.use(apply(devHeaders(HOST, DEV_PORT)));
    },
    configurePreviewServer(server) {
      server.middlewares.use(apply(prodHeaders()));
    },
  };
}

export default defineConfig({
  plugins: [securityHeaders(), inlineBinary(), svelte(), cspMetaTag()],
  server: {
    host: HOST,
    port: DEV_PORT,
    strictPort: true,
  },
  preview: {
    host: HOST,
    port: PREVIEW_PORT,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep everything as files so the strict CSP never needs data: scripts.
    assetsInlineLimit: 0,
    // PDF.js's own worker is ~1.3 MB; it loads only when a tool needs previews.
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
    // Workers are bundled separately; the MuPDF worker inlines its .wasm too.
    plugins: () => [inlineBinary()],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The first MuPDF test in a file also pays for loading MuPDF's wasm and
    // building the shared test PDFs. With files running side by side on a
    // 2-core CI runner that alone takes 5-6 s, over Vitest's 5 s default.
    testTimeout: 20_000,
  },
});
