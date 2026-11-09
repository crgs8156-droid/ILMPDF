// Cancel: a job's worker must end the moment its signal is aborted, and the
// job must fail with the "nothing was saved" message. Node has no Worker, so
// a stand-in records what the orchestrator does with it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLED, runMupdfJob, runPdfJob } from '../../src/core/orchestrator';
import { cleanIf } from '../../src/core/clean';
import { runBatch } from '../../src/core/batch';
import { ToolRun } from '../../src/core/run.svelte';

class FakeWorker {
  static made: FakeWorker[] = [];
  terminated = false;
  posted = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage() {
    this.posted++;
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.made = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

const file = () => new Uint8Array([1, 2, 3]);

describe('Cancel', () => {
  it('ends a running pdf-lib job at once', async () => {
    const stop = new AbortController();
    const job = runPdfJob({ op: 'stripMetadata', file: file() }, { signal: stop.signal });
    expect(FakeWorker.made[0]!.posted).toBe(1);
    stop.abort();
    await expect(job).rejects.toThrow(CANCELLED);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
  });

  it('ends a running MuPDF job at once', async () => {
    const stop = new AbortController();
    const job = runMupdfJob({ op: 'compress', file: file(), level: 'light' }, { signal: stop.signal });
    stop.abort();
    await expect(job).rejects.toThrow(CANCELLED);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
  });

  it('never sends the file when the signal is already aborted', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(runPdfJob({ op: 'stripMetadata', file: file() }, { signal: stop.signal })).rejects.toThrow(CANCELLED);
    expect(FakeWorker.made[0]!.posted).toBe(0);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
  });

  it('a job without a signal still runs as before', () => {
    void runPdfJob({ op: 'stripMetadata', file: file() });
    expect(FakeWorker.made[0]!.terminated).toBe(false);
    FakeWorker.made[0]!.terminate();
  });

  it('reaches the "Also remove scripts" step', async () => {
    const stop = new AbortController();
    const job = cleanIf(true, [file()], stop.signal);
    stop.abort();
    await expect(job).rejects.toThrow(CANCELLED);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
  });

  it('stops a batch instead of marking the file as failed', async () => {
    const stop = new AbortController();
    const steps: unknown[] = [];
    const run = runBatch(
      [
        { name: 'a.pdf', bytes: file() },
        { name: 'b.pdf', bytes: file() },
      ],
      { kind: 'stripMetadata' },
      false,
      (_, r) => steps.push(r),
      stop.signal,
    );
    stop.abort();
    await expect(run).rejects.toThrow();
    expect(steps).toEqual([]);
    expect(FakeWorker.made).toHaveLength(1);
  });
});

describe('ToolRun', () => {
  it('Cancel marks the run as cancelled, not failed, and drops its result', async () => {
    const run = new ToolRun();
    let saved = false;
    const going = run.run(async (signal) => {
      await runPdfJob({ op: 'stripMetadata', file: file() }, { signal });
      saved = true;
      return 'Saved.';
    });
    expect(run.busy).toBe(true);
    run.cancel();
    await going;
    expect(saved).toBe(false);
    expect(run.cancelled).toBe(true);
    expect(run.errors).toEqual([]);
    expect(run.done).toEqual([]);
    expect(run.busy).toBe(false);
  });

  it('a task that ignores the signal still reports nothing after Cancel', async () => {
    const run = new ToolRun();
    let release = () => {};
    const going = run.run(() => new Promise<string>((r) => (release = () => r('Saved.'))));
    run.cancel();
    release();
    await going;
    expect(run.done).toEqual([]);
    expect(run.cancelled).toBe(true);
  });

  it('progress is shown only while running and cleared after', async () => {
    const run = new ToolRun();
    run.report(1, 2, 'ignored');
    expect(run.progress).toBeNull();
    await run.run(async () => {
      run.report(1, 2, 'Page 2 of 2');
      expect(run.progress).toEqual({ done: 1, total: 2, label: 'Page 2 of 2' });
    });
    expect(run.progress).toBeNull();
  });

  it('a new run clears the last Cancel note', async () => {
    const run = new ToolRun();
    const going = run.run(async (signal) => void (await runPdfJob({ op: 'stripMetadata', file: file() }, { signal })));
    run.cancel();
    await going;
    expect(run.cancelled).toBe(true);
    await run.run(async () => 'ok');
    expect(run.cancelled).toBe(false);
    expect(run.done).toEqual(['ok']);
  });
});
