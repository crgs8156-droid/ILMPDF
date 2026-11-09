<script lang="ts">
  // "Continue with this file": after the open tool saves a PDF, offers to open
  // that result in another tool, so you can chain tools without downloading
  // and dropping the file again. App.svelte shows it under every tool and
  // re-creates it when the tool changes, so only results saved since this
  // tool opened count. The result stays in memory only (core/shelf.svelte.ts).
  import Notice from './Notice.svelte';
  import OpenIn from '../pages/OpenIn.svelte';
  import { shelf } from '../core/shelf.svelte';
  import { latestPdfFrom } from '../core/shelf-rules';
  import { continueWith } from '../core/files';

  type Props = { tool: string };
  let { tool }: Props = $props();

  const openedAt = Date.now();
  const result = $derived(latestPdfFrom(shelf.saved, tool, openedAt));
  let busy = $state(false);
  let errors = $state<string[]>([]);

  async function pick(next: string) {
    if (!result || busy) return;
    busy = true;
    errors = [];
    const why = await continueWith(result.id, next);
    busy = false;
    if (why) errors = [why];
  }
</script>

{#if result}
  <div class="continue" data-testid="continue-with">
    <span>Continue with <strong>{result.name}</strong> in</span>
    <OpenIn name={result.name} onPick={pick} exclude={tool} label="pick a tool…" testid="continue-in" />
    {#if busy}<span class="muted">Reading…</span>{/if}
  </div>
{/if}
<Notice messages={errors} />

<style>
  .continue {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    font-size: 14px;
  }
  .continue strong {
    overflow-wrap: anywhere;
  }
</style>
