/// <reference types="vitest/config" />
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

export default defineConfig({
  plugins: [svelte(), cspMetaTag()],
  server: {
    host: HOST,
    port: DEV_PORT,
    strictPort: true,
    headers: devHeaders(HOST, DEV_PORT),
  },
  preview: {
    host: HOST,
    port: PREVIEW_PORT,
    strictPort: true,
    headers: prodHeaders(),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep everything as files so the strict CSP never needs data: scripts.
    assetsInlineLimit: 0,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
