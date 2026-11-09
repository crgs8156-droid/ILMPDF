// ILMPDF's own local server, used instead of `vite preview` for daily use and
// for the browser tests. Run it with `npm run preview` after `npm run build`.
//
// It is deliberately tiny so it can be read in a few minutes. It:
// - listens on 127.0.0.1 only (never reachable from other devices, rule 8);
// - answers only GET and HEAD, and only for files inside dist/;
// - refuses requests whose Host is not this server (blocks DNS rebinding:
//   a web page you visit can't point its own name at 127.0.0.1 and read
//   ILMPDF through it);
// - refuses dot files, paths that try to leave dist/ (../, encoded or not,
//   or via a symlink) and file types the app doesn't use;
// - puts the exact headers from security-headers.ts on EVERY reply,
//   including 304, 404, 405 and errors (rule 2: the headers live there only);
// - never makes a network request, never writes anything, and logs no paths.
//
// Plain Node.js, no library. Node runs this TypeScript file directly
// (type stripping, Node 22.18 or newer).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prodHeaders } from '../security-headers.ts';

export const HOST = '127.0.0.1';
export const PORT = 4173;

/** The only file types ILMPDF's build contains. Anything else is a 404. */
export const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** True when the Host header names this server, so DNS rebinding is refused. */
export function allowedHost(host: string | undefined, port: number): boolean {
  return host === `${HOST}:${port}` || host === `localhost:${port}`;
}

/**
 * Maps a request path to a file inside `root` (already a real path), or null
 * when it must be refused. Pure apart from reading the disk, so unit tests
 * can try hostile paths against it.
 */
export function resolveFile(root: string, rawUrl: string): string | null {
  const pathname = rawUrl.split(/[?#]/, 1)[0] ?? '';
  if (!pathname.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // broken %-encoding
  }
  // No NUL bytes, no backslashes (Windows-style tricks), no dot files or "..".
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return null;
  const wanted = path.join(root, ...(parts.length ? parts : ['index.html']));
  if (!(path.extname(wanted).toLowerCase() in TYPES)) return null;
  let real: string;
  try {
    real = realpathSync(wanted); // follows symlinks, so one pointing out of dist/ is caught below
    if (!statSync(real).isFile()) return null;
  } catch {
    return null; // missing
  }
  return real.startsWith(root + path.sep) ? real : null;
}

/** A plain-text reply that still carries every security header. */
function refuse(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...prodHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

export function handle(root: string, port: number, req: IncomingMessage, res: ServerResponse): void {
  if (!allowedHost(req.headers.host, port)) return refuse(res, 421, 'Wrong host\n');
  if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
  const file = resolveFile(root, req.url ?? '/');
  if (!file) return refuse(res, 404, 'Not found\n');

  const { size, mtimeMs } = statSync(file);
  // Changes whenever you rebuild, so Safari never keeps running old code.
  const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
  const headers = {
    ...prodHeaders(),
    'Content-Type': TYPES[path.extname(file).toLowerCase()]!,
    // Always ask again: a quick 304 when nothing changed, the new file after a rebuild.
    'Cache-Control': 'no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return void res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(size) });
  if (req.method === 'HEAD') return void res.end();
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** Creates (but does not start) the server for a built app in `distDir`. */
export function createIlmpdfServer(distDir: string): Server {
  const root = realpathSync(distDir);
  const server: Server = createServer((req, res) => {
    try {
      // The port it is really listening on (tests use a random free one).
      handle(root, (server.address() as AddressInfo).port, req, res);
    } catch {
      if (!res.headersSent) refuse(res, 500, 'Server error\n');
      else res.destroy();
    }
  });
  // Short limits: only this Mac talks to it, and only for small requests.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  return server;
}

// Started directly (npm run preview), not imported by a test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  let server: Server;
  try {
    server = createIlmpdfServer(dist);
  } catch {
    console.error('No build found. Run npm run build first.');
    process.exit(1);
  }
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use: is ILMPDF already running?` : `Server error: ${err.message}`);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => console.log(`ILMPDF is running at http://${HOST}:${PORT}/ (this Mac only). Press Ctrl+C to stop.`));
}
