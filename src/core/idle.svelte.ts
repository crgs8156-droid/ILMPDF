// Auto-clear when idle: after IDLE_CLEAR_MS with no mouse, key, scroll or
// touch, every file and result is forgotten and the app goes back to the
// Dashboard, so an open tool lets go of the PDF it was holding. A sleeping
// Mac or a hidden tab counts as idle (see idle-rules.ts for why the wall
// clock is used). Nothing about this is stored anywhere (rule 7).
import { nav } from './nav.svelte';
import { shelf } from './shelf.svelte';
import { jobActivity } from './orchestrator';
import { idleState } from './idle-rules';

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
const CHECK_EVERY_MS = 15_000;

class Idle {
  /** True while the "Clearing your files in 1 minute" banner shows. */
  warning = $state(false);
  /** True after an auto-clear, until you leave the Dashboard. */
  cleared = $state(false);
  private lastInput = Date.now();

  /** Anything that may hold a document: the shelf or an open tool. */
  private get hasFiles(): boolean {
    return shelf.files.length + shelf.saved.length + shelf.recent.length > 0 || nav.route.kind === 'tool';
  }

  /**
   * You are here: restart the 15 minutes. The banner is left alone (the next
   * check hides it), so moving the mouse towards "Keep my files" doesn't
   * make the button jump away under the pointer.
   */
  touch = (): void => {
    this.lastInput = Date.now();
  };

  /** The "Keep my files" button. */
  keep = (): void => {
    this.touch();
    this.warning = false;
  };

  /** Looks at the clock and warns or clears if it is time. */
  check = (): void => {
    const jobs = jobActivity();
    const state = idleState({
      lastActive: Math.max(this.lastInput, jobs.lastEnd),
      now: Date.now(),
      hasFiles: this.hasFiles,
      jobs: jobs.running,
    });
    if (state === 'clear') this.clearNow();
    else this.warning = state === 'warn';
  };

  private clearNow(): void {
    shelf.clear();
    // Leaving the tool unmounts it, which drops the PDF it held. replace()
    // so Back doesn't return to a page that showed your file.
    if (nav.route.kind === 'tool') nav.replace({ kind: 'home' });
    this.warning = false;
    this.cleared = true;
    this.lastInput = Date.now();
  }

  /** Starts watching. Returns a function that stops it. */
  start(): () => void {
    this.lastInput = Date.now();
    // Checked at once when the tab shows again or the Mac wakes, so a file
    // that should be gone is never shown.
    const onShow = () => {
      if (document.visibilityState === 'visible') this.check();
    };
    for (const type of ACTIVITY) addEventListener(type, this.touch, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onShow);
    addEventListener('pageshow', onShow);
    addEventListener('focus', onShow);
    const timer = setInterval(this.check, CHECK_EVERY_MS);
    return () => {
      for (const type of ACTIVITY) removeEventListener(type, this.touch, { capture: true });
      document.removeEventListener('visibilitychange', onShow);
      removeEventListener('pageshow', onShow);
      removeEventListener('focus', onShow);
      clearInterval(timer);
    };
  }
}

export const idle = new Idle();
