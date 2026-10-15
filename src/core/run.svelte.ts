// Shared busy / error / done state for a tool's main action.
export class ToolRun {
  busy = $state(false);
  errors = $state<string[]>([]);
  done = $state<string[]>([]);

  async run(task: () => Promise<string | void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errors = [];
    this.done = [];
    try {
      const msg = await task();
      if (msg) this.done = [msg];
    } catch (err) {
      this.errors = [err instanceof Error ? err.message : 'Something went wrong.'];
    } finally {
      this.busy = false;
    }
  }
}
