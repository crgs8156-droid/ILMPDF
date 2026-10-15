<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { formatBytes, safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import type { CompressLevel } from '../engines/mupdf-ops';

  const LEVELS: { id: CompressLevel; name: string; detail: string }[] = [
    { id: 'light', name: 'Light', detail: 'No quality loss. Tidies the file; best for text documents.' },
    { id: 'recommended', name: 'Recommended', detail: 'Good quality. Images become JPEG at up to 150 dpi.' },
    { id: 'strong', name: 'Strong', detail: 'Smallest file. Images become lower-quality JPEG at up to 100 dpi.' },
  ];

  let level = $state<CompressLevel>('recommended');
  const job = new ToolRun();

  function compress(file: PdfFile) {
    job.run(async () => {
      const out = await runMupdfJob({ op: 'compress', file: copyBytes(file.bytes), level });
      const { before, after } = out.sizes!;
      if (after >= before) {
        return "This PDF is already compact: this level couldn't make it smaller, so no file was saved. Try a stronger level.";
      }
      saveBytes(out.files![0]!, safeFileName(file.name, '-compressed'));
      const saved = Math.round((1 - after / before) * 100);
      return `Saved a compressed copy: ${formatBytes(before)} → ${formatBytes(after)} (${saved}% smaller).`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <fieldset>
        <legend>How much to compress</legend>
        {#each LEVELS as option (option.id)}
          <label class="level">
            <input type="radio" name="level" value={option.id} bind:group={level} data-testid="level-{option.id}" />
            <span><strong>{option.name}</strong> <span class="muted">{option.detail}</span></span>
          </label>
        {/each}
      </fieldset>
      <p class="muted">The original file is unchanged. Check the result before deleting the original.</p>
      <div class="actions">
        <button type="button" disabled={job.busy} onclick={() => compress(file)} data-testid="run">
          {job.busy ? 'Compressing…' : 'Compress PDF'}
        </button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>

<style>
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px 12px;
    margin: 0 0 12px;
    display: grid;
    gap: 8px;
  }
  legend {
    color: var(--muted);
    font-size: 13px;
    padding: 0 4px;
  }
  .level {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
</style>
