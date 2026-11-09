import { describe, expect, it } from 'vitest';
import { idleState } from '../../src/core/idle-rules';
import { IDLE_CLEAR_MS, IDLE_WARN_MS } from '../../src/core/limits';

const MIN = 60_000;
const base = { lastActive: 0, hasFiles: true, jobs: 0 };

describe('idleState', () => {
  it('uses one fixed 15-minute time with a 1-minute warning', () => {
    expect(IDLE_CLEAR_MS).toBe(15 * MIN);
    expect(IDLE_WARN_MS).toBe(MIN);
  });

  it('stays active, then warns, then clears', () => {
    expect(idleState({ ...base, now: 13 * MIN })).toBe('active');
    expect(idleState({ ...base, now: 14 * MIN - 1 })).toBe('active');
    expect(idleState({ ...base, now: 14 * MIN })).toBe('warn');
    expect(idleState({ ...base, now: 15 * MIN - 1 })).toBe('warn');
    expect(idleState({ ...base, now: 15 * MIN })).toBe('clear');
  });

  it('clears at once after a long sleep, with no warning first', () => {
    // Timers stop while the Mac sleeps; the first check after waking sees the jump.
    expect(idleState({ ...base, now: 8 * 60 * MIN })).toBe('clear');
  });

  it('does nothing when there is nothing to clear', () => {
    expect(idleState({ ...base, hasFiles: false, now: 60 * MIN })).toBe('active');
  });

  it('never clears while a job is running', () => {
    expect(idleState({ ...base, jobs: 1, now: 60 * MIN })).toBe('active');
  });

  it('treats a clock set backwards as recent use', () => {
    expect(idleState({ ...base, lastActive: 10 * MIN, now: 0 })).toBe('active');
  });
});
