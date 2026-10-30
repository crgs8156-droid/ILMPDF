<script lang="ts">
  // The newest uses of your files. Used on the dashboard (a few) and on the
  // Recent files page (all).
  import FileRow from './FileRow.svelte';
  import OpenIn from './OpenIn.svelte';
  import { shelf } from '../core/shelf.svelte';
  import { timeAgo } from '../core/shelf-rules';
  import { formatBytes } from '../core/validate';
  import { TOOLS } from '../tools/registry';
  import { ONE_PDF_TOOLS } from '../tools/one-pdf-tools';
  import { useClock } from './Clock.svelte';

  type Props = { limit?: number };
  let { limit = Infinity }: Props = $props();
  const clock = useClock();
  const rows = $derived(shelf.recent.slice(0, limit).flatMap((r) => {
    const file = shelf.file(r.fileId);
    const tool = TOOLS.find((t) => t.id === r.tool);
    return file && tool ? [{ r, file, tool }] : [];
  }));
</script>

{#if rows.length === 0}
  <p class="blank" data-testid="recent-empty">Nothing yet. PDFs you open in a tool show up here until you close this tab.</p>
{:else}
  <ul class="rows" data-testid="recent-list">
    {#each rows as { r, file, tool } (r.id)}
      <FileRow name={file.name} detail="{tool.name} · {formatBytes(file.size)} · {timeAgo(r.at, clock.now)}">
        {#snippet actions()}
          {#if ONE_PDF_TOOLS.includes(tool.id)}
            <button type="button" class="quiet" onclick={() => shelf.openIn(file.id, tool.id)} data-testid="again">{tool.name} again</button>
          {/if}
          <OpenIn fileId={file.id} name={file.name} />
        {/snippet}
      </FileRow>
    {/each}
  </ul>
{/if}
