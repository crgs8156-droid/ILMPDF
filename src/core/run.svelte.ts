// Shared busy / error / done state for a tool's main action, with Cancel.
//
// Each run gets its own stop switch (an AbortController). The task receives
// its signal and must hand it to every job it starts (runPdfJob,
// runMupdfJob, runOcrJob, cleanIf, removeScripts, runBatch). Cancel flips
// the switch, which ends the job's worker at once, so the task's `await`
// fails before it reaches any save: nothing is saved after Cancel.
// tests/unit/cancel-wiring.test.ts checks that every tool passes the signal on.
export type RunProgress = { done: number; total: number; label: string };

export class ToolRun {
  busy = $state(false);
  errors = $state<string[]>([]);
  done = $state<string[]>([]);
  /** True after the last run was stopped with Cancel (RunStatus shows a note). */
  cancelled = $state(false);
  /** When the current run started (ms since epoch), for the elapsed-time counter. */
  startedAt = $state(0);
  /** Optional "page 3 of 20" style progress; tools set it with report(). */
  progress = $state<RunProgress | null>(null);
  /** What to say after a Cancel, for tools that save as they go (default: nothing was saved). */
  cancelNote: string | null = null;
  private stopper: AbortController | null = null;

  async run(task: (signal: AbortSignal) => Promise<string | void>): Promise<void> {
    if (this.busy) return;
    const stopper = new AbortController();
    this.stopper = stopper;
    this.busy = true;
    this.errors = [];
    this.done = [];
    this.cancelled = false;
    this.progress = null;
    this.startedAt = Date.now();
    try {
      const msg = await task(stopper.signal);
      // A task that ignored the signal could still finish after Cancel;
      // its result is then thrown away rather than reported.
      stopper.signal.throwIfAborted();
      if (msg) this.done = [msg];
    } catch (err) {
      if (stopper.signal.aborted) this.cancelled = true;
      else this.errors = [err instanceof Error ? err.message : 'Something went wrong.'];
    } finally {
      this.stopper = null;
      this.progress = null;
      this.busy = false;
    }
  }

  /** Stops the current run, if any. */
  cancel(): void {
    this.stopper?.abort();
  }

  /** Shows progress under the tool's button while it runs. */
  report(done: number, total: number, label: string): void {
    if (this.busy) this.progress = { done, total, label };
  }
}
