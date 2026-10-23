// Fuzz worker: runs one engine operation on one (hostile) file at a time,
// inside a Node worker thread, the same way the app runs each job inside a
// Web Worker. tests/fuzz/fuzz.test.ts bundles this file with Vite and starts
// it, so a case that hangs or crashes can be stopped without stopping the
// tests themselves.
import { parentPort } from 'node:worker_threads';
import net from 'node:net';
import * as mupdf from 'mupdf';
import * as pdflib from '../../src/engines/pdflib-ops';
import * as mu from '../../src/engines/mupdf-ops';
import { extractImages } from '../../src/engines/mupdf-images';
import { flatten } from '../../src/engines/mupdf-flatten';
import { readBookmarks } from '../../src/engines/mupdf-bookmarks';

// Any attempt to reach the network is recorded and refused. The engines are
// never expected to try; this proves it for every hostile file.
let netAttempts = 0;
globalThis.fetch = (() => {
  netAttempts++;
  return Promise.reject(new Error('network blocked by fuzz runner'));
}) as typeof fetch;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  netAttempts++;
  this.destroy(new Error('network blocked by fuzz runner'));
  return this;
} as unknown as typeof connect;

export const OPS: Record<string, (bytes: Uint8Array) => unknown> = {
  'pdf-lib pageCount': (b) => pdflib.pageCount(b),
  'pdf-lib readMetadata': (b) => pdflib.readMetadata(b),
  'pdf-lib stripMetadata': (b) => pdflib.stripMetadata(b),
  'pdf-lib pageNumbers': (b) => pdflib.addPageNumbers(b, { position: 'bottom-center', startAt: 1, fontSize: 12, format: 'n' }),
  'mupdf inspect': (b) => mu.inspect(mupdf, b),
  'mupdf repair': (b) => mu.repair(mupdf, b),
  'mupdf extractText': (b) => mu.extractText(mupdf, b),
  'mupdf sanitize': (b) => mu.sanitize(mupdf, b),
  'mupdf compress': (b) => mu.compress(mupdf, b, 'recommended'),
  'mupdf readForm': (b) => mu.readForm(mupdf, b),
  'mupdf readBookmarks': (b) => readBookmarks(mupdf, b),
  'mupdf extractImages': (b) => extractImages(mupdf, b, { pages: [0], skipTiny: false }),
  'mupdf flatten': (b) => flatten(mupdf, b, { annotations: true, fields: true }),
  // Self-tests that prove the harness notices a hang and a network attempt.
  'selftest hang': () => {
    for (;;);
  },
  'selftest network': () => fetch('https://example.invalid/leak').catch(() => undefined),
};

export type FuzzRequest = { id: number; op: string; bytes: Uint8Array };
export type FuzzReply = { id: number; ok: boolean; userFacing: boolean; error?: string; netAttempts: number };

parentPort?.on('message', async ({ id, op, bytes }: FuzzRequest) => {
  const before = netAttempts;
  let reply: FuzzReply;
  try {
    await OPS[op]!(bytes);
    reply = { id, ok: true, userFacing: false, netAttempts: netAttempts - before };
  } catch (err) {
    reply = {
      id,
      ok: false,
      userFacing: err instanceof pdflib.UserFacingError,
      error: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : String(err).slice(0, 300),
      netAttempts: netAttempts - before,
    };
  }
  parentPort!.postMessage(reply);
});
