// Checks the real preview server: every kind of reply (page, scripts,
// workers, WebAssembly, styles, 304s, 404s) carries the full set of
// security headers, and the server can't be reached from other devices.
import { expect, test, type APIResponse } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { PROD_CSP, prodHeaders } from '../../security-headers';

// The same headers for every browser, so run these once.
test.skip(({ browserName }) => browserName !== 'chromium', 'server checks run once');

const EXPECTED = Object.entries(prodHeaders()).map(([k, v]) => [k.toLowerCase(), v] as const);

function expectAllHeaders(response: APIResponse, what: string): void {
  const h = response.headers();
  for (const [name, value] of EXPECTED) expect(h[name], `${name} on ${what}`).toBe(value);
}

// One built file of each kind, read from dist/ (the webServer builds it first).
function sampleAssets(): string[] {
  const files = readdirSync('dist/assets');
  const pick = (re: RegExp) => files.find((f) => re.test(f));
  const chosen = [
    pick(/^index-.*\.js$/),
    pick(/\.css$/),
    pick(/\.wasm$/),
    pick(/\.mjs$/),
    pick(/worker.*\.js$/i),
  ];
  expect(chosen.every(Boolean), `dist/assets has each kind of file: ${chosen.join(', ')}`).toBe(true);
  return chosen.map((f) => `/assets/${f}`);
}

test('every kind of reply carries all security headers', async ({ request }) => {
  for (const path of ['/', ...sampleAssets()]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expectAllHeaders(response, path);
  }
});

test('revalidated (304) scripts and wasm keep all security headers', async ({ request }) => {
  for (const path of sampleAssets()) {
    const first = await request.get(path);
    const etag = first.headers()['etag'];
    expect(etag, path).toBeTruthy();
    const again = await request.get(path, { headers: { 'If-None-Match': etag! } });
    expect(again.status(), path).toBe(304);
    expectAllHeaders(again, `304 ${path}`);
  }
});

// Vite answers unknown paths with the app page (single-page-app fallback);
// whatever it answers must still carry the headers.
test('an unknown path still gets the security headers', async ({ request }) => {
  for (const path of ['/assets/does-not-exist.js', '/no/such/page']) {
    expectAllHeaders(await request.get(path), path);
  }
});

test('the page also carries the CSP as a meta tag', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
  // frame-ancestors only works as a header, so the meta copy leaves it out.
  const expected = PROD_CSP.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ');
  expect(meta).toBe(expected);
});

test('the server cannot be reached from other devices', async () => {
  const outward = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && !a.internal && a.family === 'IPv4')
    .map((a) => a!.address);
  // A machine with no network has nothing to check; loopback is covered by baseURL.
  for (const address of outward) {
    const reached = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: address, port: 4173, timeout: 2000 });
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => (socket.destroy(), resolve(false)));
    });
    expect(reached, `port 4173 on ${address}`).toBe(false);
  }
});
