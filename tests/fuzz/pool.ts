// Runs fuzz cases in a Node worker thread with a time limit, like the app's
// orchestrator does with Web Workers: a case that hangs is stopped by
// terminating the worker, and a case that crashes the worker is recorded;
// either way a fresh worker takes over for the next case.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import type { FuzzReply } from './runner';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Inside node_modules so the bundle finds mupdf and pdf-lib, and git-ignored.
const OUT_DIR = path.join(ROOT, 'node_modules', '.ilmpdf-fuzz');

/** Bundles runner.ts (TypeScript, extensionless imports) into one .mjs Node can run. */
export async function buildRunner(): Promise<string> {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    build: {
      ssr: path.join(ROOT, 'tests/fuzz/runner.ts'),
      outDir: OUT_DIR,
      emptyOutDir: true,
      rollupOptions: { output: { format: 'es', entryFileNames: 'runner.mjs' } },
    },
  });
  return path.join(OUT_DIR, 'runner.mjs');
}

export type Outcome =
  | { kind: 'ok'; netAttempts: number }
  | { kind: 'error'; userFacing: boolean; error: string; netAttempts: number }
  | { kind: 'hang' }
  | { kind: 'crash'; error: string };

export class FuzzPool {
  private worker: Worker | null = null;
  private nextId = 0;

  constructor(
    private readonly script: string,
    private readonly timeoutMs: number,
  ) {}

  private start(): Worker {
    // A memory cap close to what a browser tab allows a worker.
    // MuPDF prints a warning for every broken object; keep the test output readable.
    this.worker = new Worker(this.script, { resourceLimits: { maxOldGenerationSizeMb: 2048 }, stdout: true, stderr: true });
    this.worker.stdout.resume();
    this.worker.stderr.resume();
    return this.worker;
  }

  run(op: string, bytes: Uint8Array): Promise<Outcome> {
    const worker = this.worker ?? this.start();
    const id = this.nextId++;
    return new Promise((resolve) => {
      const done = (outcome: Outcome, restart: boolean) => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        if (restart) {
          void worker.terminate();
          this.worker = null;
        }
        resolve(outcome);
      };
      const onMessage = (r: FuzzReply) => {
        if (r.id !== id) return;
        done(r.ok ? { kind: 'ok', netAttempts: r.netAttempts } : { kind: 'error', userFacing: r.userFacing, error: r.error ?? '', netAttempts: r.netAttempts }, false);
      };
      const onError = (e: Error) => done({ kind: 'crash', error: String(e).slice(0, 300) }, true);
      const onExit = (code: number) => done({ kind: 'crash', error: `worker exited with code ${code}` }, true);
      const timer = setTimeout(() => done({ kind: 'hang' }, true), this.timeoutMs);
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      worker.postMessage({ id, op, bytes: bytes.slice() });
    });
  }

  async close(): Promise<void> {
    await this.worker?.terminate();
    this.worker = null;
  }
}
