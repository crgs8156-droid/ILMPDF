// Progress reports from the engines ("page 3 of 20"). Engines run inside a
// worker; the worker passes each report to the page with postMessage, where
// the tool shows it under its button (ToolRun.report).

/** What the engine is busy with: going through pages, images, or writing the file. */
export type ProgressStep = 'page' | 'image' | 'save';

export type Progress = (done: number, total: number, step: ProgressStep) => void;

/** For engines called without a listener (unit tests, Batch). */
export const noProgress: Progress = () => {};

/**
 * Passes on at most one report every `ms` milliseconds, so a 5,000-page file
 * doesn't flood the page with messages. A report that finishes a step
 * (done === total) and every change of step always go through.
 */
export function throttled(report: Progress, ms = 150, now: () => number = Date.now): Progress {
  let last = -Infinity;
  let lastStep: ProgressStep | null = null;
  return (done, total, step) => {
    const t = now();
    if (step !== lastStep || done >= total || t - last >= ms) {
      last = t;
      lastStep = step;
      report(done, total, step);
    }
  };
}

/** The words a tool shows for a report. */
export function progressLabel(done: number, total: number, step: ProgressStep): string {
  if (step === 'save') return 'Saving the new file…';
  const noun = step === 'page' ? 'page' : 'image';
  return done < total ? `Working on ${noun} ${done + 1} of ${total}…` : `All ${total} ${noun}s done, finishing…`;
}
