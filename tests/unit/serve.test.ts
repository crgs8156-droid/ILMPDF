// Our own local server (scripts/serve.ts): only files inside dist/, only on
// 127.0.0.1, only GET and HEAD, and the exact security headers on every
// reply. Uses a throwaway folder of fake files, never a real build or PDF.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowedHost, createIlmpdfServer, resolveFile } from '../../scripts/serve';
import { prodHeaders } from '../../security-headers';

let base: string;
let root: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ilmpdf-serve-')));
  root = path.join(base, 'dist');
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(path.join(root, 'assets', 'app.js'), 'export {};');
  writeFileSync(path.join(root, 'assets', 'engine.wasm'), new Uint8Array([0, 97, 115, 109]));
  writeFileSync(path.join(root, 'assets', 'notes.txt'), 'not an app file type');
  writeFileSync(path.join(root, '.env'), 'SECRET=1');
  writeFileSync(path.join(base, 'outside.js'), 'secret outside dist');
  symlinkSync(path.join(base, 'outside.js'), path.join(root, 'assets', 'link.js'));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('resolveFile', () => {
  it('serves files inside dist/, with / as index.html', () => {
    expect(resolveFile(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveFile(root, '/assets/app.js?v=1')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveFile(root, '/assets/engine.wasm')).toBe(path.join(root, 'assets', 'engine.wasm'));
  });

  it('refuses every way out of dist/', () => {
    for (const url of [
      '/../outside.js',
      '/assets/../../outside.js',
      '/%2e%2e/outside.js',
      '/assets/%2E%2E%2F%2E%2E%2Foutside.js',
      '/..%5coutside.js',
      '/assets/link.js', // a symlink pointing outside
      '//etc/passwd',
    ]) {
      expect(resolveFile(root, url), url).toBeNull();
    }
  });

  it('refuses dot files, unknown types, missing files and broken input', () => {
    for (const url of ['/.env', '/assets/notes.txt', '/assets/missing.js', '/assets', '/%E0%A4%A', '/index.html%00.js', 'index.html']) {
      expect(resolveFile(root, url), url).toBeNull();
    }
  });
});

describe('allowedHost', () => {
  it('accepts only this server by IP or localhost', () => {
    expect(allowedHost('127.0.0.1:4173', 4173)).toBe(true);
    expect(allowedHost('localhost:4173', 4173)).toBe(true);
    expect(allowedHost('evil.example:4173', 4173)).toBe(false);
    expect(allowedHost('127.0.0.1:4174', 4173)).toBe(false);
    expect(allowedHost(undefined, 4173)).toBe(false);
  });
});

describe('the running server', () => {
  let server: ReturnType<typeof createIlmpdfServer>;
  let port = 0;

  beforeAll(async () => {
    server = createIlmpdfServer(root);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
  function ask(pathName: string, opts: { method?: string; host?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: pathName, method: opts.method ?? 'GET', headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...opts.headers } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  function expectAllHeaders(reply: Reply, what: string) {
    for (const [name, value] of Object.entries(prodHeaders())) expect(reply.headers[name.toLowerCase()], `${name} on ${what}`).toBe(value);
  }

  it('serves the page and assets with the right types and every header', async () => {
    const page = await ask('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.body).toContain('<title>t</title>');
    expectAllHeaders(page, '/');
    const wasm = await ask('/assets/engine.wasm');
    expect(wasm.headers['content-type']).toBe('application/wasm');
    expectAllHeaders(wasm, 'wasm');
  });

  it('answers a revalidation with 304 and every header', async () => {
    const first = await ask('/assets/app.js');
    const etag = first.headers['etag'] as string;
    expect(etag).toBeTruthy();
    expect(first.headers['cache-control']).toBe('no-cache');
    const again = await ask('/assets/app.js', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expectAllHeaders(again, '304');
  });

  it('refusals carry every header too: 404, 405 and wrong host', async () => {
    const missing = await ask('/../outside.js');
    expect(missing.status).toBe(404);
    expect(missing.body).not.toContain('secret');
    expectAllHeaders(missing, '404');

    const post = await ask('/', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers['allow']).toBe('GET, HEAD');
    expectAllHeaders(post, '405');

    const rebind = await ask('/', { host: `attacker.example:${port}` });
    expect(rebind.status).toBe(421);
    expect(rebind.body).not.toContain('<title>');
    expectAllHeaders(rebind, '421');
  });

  it('HEAD gives the headers without the body', async () => {
    const head = await ask('/assets/app.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe(String('export {};'.length));
  });
});
