<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { everyNPages, parsePageGroups } from '../core/page-spec';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { inZip, saveFiles } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import RunStatus from '../lib/RunStatus.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import ZipOption from '../lib/ZipOption.svelte';

  let mode = $state<'ranges' | 'every'>('ranges');
  let spec = $state('');
  let size = $state(1);
  const job = new ToolRun();
  let alsoClean = $state(false);
  let asZip = $state(true);

  function split(file: PdfFile) {
    job.run(async (signal) => {
      let groups: number[][];
      if (mode === 'every') {
        groups = everyNPages(file.pages, size);
      } else {
        const parsed = parsePageGroups(spec, file.pages);
        if (!parsed.ok) throw new Error(parsed.error);
        groups = parsed.groups;
      }
      const out = await runPdfJob({ op: 'pick', file: copyBytes(file.bytes), groups }, { signal });
      const { files, note } = await cleanIf(alsoClean, out.files!, signal);
      const named = files.map((bytes, i) => ({ name: safeFileName(file.name, `-part-${i + 1}`), bytes }));
      const zip = saveFiles(named, safeFileName(file.name, '-parts', '.zip'), asZip);
      return `Created ${files.length} PDF${files.length === 1 ? '' : 's'}${inZip(zip)}.${note}`;
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
      <ZipOption bind:checked={asZip} />
      <div class="actions">
        <button disabled={job.busy} onclick={() => split(file)} data-testid="run">{job.busy ? 'Splitting…' : 'Split PDF'}</button>
        <RunStatus run={job} />
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>
