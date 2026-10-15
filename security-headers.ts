// Single source of truth for ILMPDF's security headers.
// Production (vite preview / the installed app) uses the strict policy.
// Dev relaxes only what Vite's hot reload needs: a websocket back to
// the dev server and inline <style> tags injected during development.

const shared = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), display-capture=(), interest-cohort=()',
};

const baseCsp = {
  'default-src': ["'self'"],
  // 'wasm-unsafe-eval' lets WebAssembly compile; it does not allow JS eval.
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  // The zero-egress rule: the page may not open any network connection.
  'connect-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
  'frame-ancestors': ["'none'"],
};

type Csp = Record<string, string[]>;

function serialize(csp: Csp): string {
  return Object.entries(csp)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

export const PROD_CSP = serialize(baseCsp);

export function devCsp(host: string, port: number): string {
  return serialize({
    ...baseCsp,
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': [`ws://${host}:${port}`],
  });
}

export function prodHeaders(): Record<string, string> {
  return { ...shared, 'Content-Security-Policy': PROD_CSP };
}

export function devHeaders(host: string, port: number): Record<string, string> {
  return { ...shared, 'Content-Security-Policy': devCsp(host, port) };
}
