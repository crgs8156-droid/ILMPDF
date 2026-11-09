<script lang="ts">
  // Sits in a tool's .actions row, right after the main button. While the
  // tool works it shows a Cancel button, how long it has been working and,
  // when the tool reports it, a "page 3 of 20" bar. After a Cancel it says
  // that nothing was saved.
  import Notice from './Notice.svelte';
  import type { ToolRun } from '../core/run.svelte';
  import { CANCELLED } from '../core/orchestrator';

  type Props = { run: ToolRun };
  let { run }: Props = $props();

  let now = $state(Date.now());

  // Ticks once a second, only while a job runs.
  $effect(() => {
    if (!run.busy) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
</script>

{#if run.busy}
  <button type="button" class="quiet" onclick={() => run.cancel()} data-testid="cancel">Cancel</button>
  <span class="muted elapsed" data-testid="elapsed" aria-live="off">{elapsed}</span>
  {#if run.progress}
    <div class="progress" data-testid="progress">
      <progress value={run.progress.done} max={run.progress.total}></progress>
      <span class="muted">{run.progress.label}</span>
    </div>
  {/if}
{:else if run.cancelled}
  <div class="note"><Notice kind="info" messages={[run.cancelNote ?? CANCELLED]} /></div>
{/if}

<style>
  .elapsed {
    font-variant-numeric: tabular-nums;
    font-size: 13px;
  }
  /* Full-width rows inside the flex .actions row. */
  .progress,
  .note {
    flex-basis: 100%;
    display: grid;
    gap: 4px;
  }
  progress {
    width: 100%;
  }
</style>
