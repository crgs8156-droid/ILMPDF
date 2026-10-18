<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { everyNPages, parsePageGroups } from '../core/page-spec';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';

  let mode = $state<'ranges' | 'every'>('ranges');
  let spec = $state('');
  let size = $state(1);
  const job = new ToolRun();
  let alsoClean = $state(false);

  function split(file: PdfFile) {
    job.run(async () => {
      let groups: number[][];
      if (mode === 'every') {
        groups = everyNPages(file.pages, size);
      } else {
        const parsed = parsePageGroups(spec, file.pages);
        if (!parsed.ok) throw new Error(parsed.error);
        groups = parsed.groups;
      }
      const out = await runPdfJob({ op: 'pick', file: copyBytes(file.bytes), groups });
      const { files, note } = await cleanIf(alsoClean, out.files!);
      files.forEach((bytes, i) => saveBytes(bytes, safeFileName(file.name, `-part-${i + 1}`)));
      return `Created ${files.length} PDF${files.length === 1 ? '' : 's'}.${note}`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <div class="fields">
        <label class="field">Split by
          <select bind:value={mode} data-testid="split-mode">
            <option value="ranges">Page ranges</option>
            <option value="every">Every N pages</option>
          </select>
        </label>
        {#if mode === 'ranges'}
          <label class="field">Ranges (one PDF per range)
            <input type="text" bind:value={spec} placeholder={`e.g. 1-3, 4, 5-${file.pages}`} data-testid="split-spec" />
          </label>
        {:else}
          <label class="field">Pages per file
            <input type="number" min="1" max={file.pages} bind:value={size} data-testid="split-size" />
          </label>
        {/if}
      </div>
      <RemoveScriptsOption bind:checked={alsoClean} />
      <div class="actions">
        <button disabled={job.busy} onclick={() => split(file)} data-testid="run">{job.busy ? 'Splitting…' : 'Split PDF'}</button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>
