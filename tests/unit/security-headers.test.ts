// Pins ILMPDF's security headers and server binding. If any of these tests
// fails, a security setting changed: that needs the owner's explicit
// approval (CLAUDE.md rule 2), and then this file is updated in the same PR.
import { describe, expect, it } from 'vitest';
import { PROD_CSP, devCsp, devHeaders, prodHeaders } from '../../security-headers';
import viteConfig from '../../vite.config';
import playwrightConfig from '../../playwright.config';

const EXPECTED_PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const EXPECTED_OTHER_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), display-capture=(), interest-cohort=()',
};

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split('; ').map((d) => {
      const [name, ...sources] = d.split(' ');
      return [name!, sources];
    }),
  );
}

describe('production security headers', () => {
  it('has exactly the approved CSP', () => {
    expect(PROD_CSP).toBe(EXPECTED_PROD_CSP);
  });

  it('has exactly the approved headers, nothing more or less', () => {
    expect(prodHeaders()).toEqual({ ...EXPECTED_OTHER_HEADERS, 'Content-Security-Policy': EXPECTED_PROD_CSP });
  });

  // A second line of defence in case the exact string above is ever updated
  // carelessly: these sources must never appear in any directive.
  it('never allows outside hosts, wildcards or JavaScript eval', () => {
    for (const [name, sources] of directives(PROD_CSP)) {
      for (const s of sources) {
        expect(s, name).not.toMatch(/^(\*|https?:|wss?:|'unsafe-eval'|'unsafe-inline'|'unsafe-hashes'|'strict-dynamic')/);
        expect(s, name).not.toContain('.');
      }
    }
    expect(directives(PROD_CSP).get('connect-src')).toEqual(["'none'"]);
  });
});

describe('dev server headers', () => {
  it('relaxes only inline styles and the hot-reload websocket on loopback', () => {
    const dev = directives(devCsp('127.0.0.1', 5173));
    const prod = directives(PROD_CSP);
    for (const [name, sources] of prod) {
      if (name === 'style-src') expect(dev.get(name)).toEqual(["'self'", "'unsafe-inline'"]);
      else if (name === 'connect-src') expect(dev.get(name)).toEqual(['ws://127.0.0.1:5173']);
      else expect(dev.get(name), name).toEqual(sources);
    }
    expect([...dev.keys()]).toEqual([...prod.keys()]);
  });

  it('keeps every other header the same as production', () => {
    const { 'Content-Security-Policy': _dev, ...rest } = devHeaders('127.0.0.1', 5173);
    expect(rest).toEqual(EXPECTED_OTHER_HEADERS);
  });
});

describe('servers listen on this Mac only', () => {
  it('dev and preview servers bind to 127.0.0.1 on fixed ports', () => {
    expect(viteConfig.server?.host).toBe('127.0.0.1');
    expect(viteConfig.server?.port).toBe(5173);
    expect(viteConfig.server?.strictPort).toBe(true);
    expect(viteConfig.preview?.host).toBe('127.0.0.1');
    expect(viteConfig.preview?.port).toBe(4173);
    expect(viteConfig.preview?.strictPort).toBe(true);
  });

  it('builds without source maps', () => {
    expect(viteConfig.build?.sourcemap).toBe(false);
  });

  it('browser tests run against the loopback server', () => {
    expect(playwrightConfig.use?.baseURL).toBe('http://127.0.0.1:4173');
  });
});
