<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';

  const job = new ToolRun();

  async function read(file: PdfFile): Promise<[string, string][]> {
    const out = await runPdfJob({ op: 'readMetadata', file: copyBytes(file.bytes) });
    return Object.entries(out.meta ?? {});
  }

  function strip(file: PdfFile) {
    job.run(async () => {
      const out = await runPdfJob({ op: 'stripMetadata', file: copyBytes(file.bytes) });
      saveBytes(out.files![0]!, safeFileName(file.name, '-clean'));
      return 'Saved a copy with the metadata removed.';
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      {#await read(file)}
        <p class="muted">Reading metadata…</p>
      {:then entries}
        {#if entries.length === 0}
          <p data-testid="meta-empty">No document metadata found.</p>
        {:else}
          <dl class="meta" data-testid="meta-list">
            {#each entries as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
          </dl>
        {/if}
      {:catch err}
        <Notice messages={[err.message]} />
      {/await}
      <p class="muted">Removes title, author, subject, keywords, creating app, dates and XMP metadata. Page content is untouched.</p>
      <div class="actions">
        <button disabled={job.busy} onclick={() => strip(file)} data-testid="run">{job.busy ? 'Working…' : 'Remove metadata'}</button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>

<style>
  .meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 0;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
