// Plain rules behind auto-clear (core/idle.svelte.ts), kept apart so they can
// be unit-tested without a browser.
import { IDLE_CLEAR_MS, IDLE_WARN_MS } from './limits';

export type IdleInput = {
  /** Wall-clock time (Date.now) of the last mouse, key, scroll or touch, or the end of the last job. */
  lastActive: number;
  now: number;
  /** True while any file, result or open tool could hold a document. */
  hasFiles: boolean;
  /** Number of jobs running in workers right now. */
  jobs: number;
};

export type IdleState = 'active' | 'warn' | 'clear';

/**
 * Decides what auto-clear should do now. It uses the wall clock, not a
 * countdown, on purpose: timers stop while the Mac sleeps and slow down in a
 * hidden tab, but the clock keeps going, so after a long sleep the first
 * check clears at once instead of starting a fresh 15 minutes.
 */
export function idleState({ lastActive, now, hasFiles, jobs }: IdleInput): IdleState {
  if (!hasFiles || jobs > 0) return 'active';
  const idle = now - lastActive;
  if (idle >= IDLE_CLEAR_MS) return 'clear';
  if (idle >= IDLE_CLEAR_MS - IDLE_WARN_MS) return 'warn';
  return 'active';
}
