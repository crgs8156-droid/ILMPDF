<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import type { NumberPosition } from '../engines/pdflib-ops';

  let position = $state<NumberPosition>('bottom-center');
  let format = $state<'n' | 'n-of-total'>('n');
  let startAt = $state(1);
  let fontSize = $state(11);
  const job = new ToolRun();
  let alsoClean = $state(false);

  function apply(file: PdfFile) {
    job.run(async () => {
      const out = await runPdfJob({
        op: 'pageNumbers',
        file: copyBytes(file.bytes),
        opts: { position, format, startAt: Number(startAt), fontSize: Number(fontSize) },
      });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-numbered'));
      return `Numbered ${file.pages} pages.${note}`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <div class="fields">
        <label class="field">Position
          <select bind:value={position}>
            <option value="bottom-center">Bottom centre</option>
            <option value="bottom-right">Bottom right</option>
            <option value="top-center">Top centre</option>
            <option value="top-right">Top right</option>
          </select>
        </label>
        <label class="field">Style
          <select bind:value={format}>
            <option value="n">1, 2, 3</option>
            <option value="n-of-total">1 of {file.pages}</option>
          </select>
        </label>
        <label class="field">Start at <input type="number" min="0" bind:value={startAt} /></label>
        <label class="field">Text size <input type="number" min="6" max="48" bind:value={fontSize} /></label>
      </div>
      <RemoveScriptsOption bind:checked={alsoClean} />
      <div class="actions">
        <button disabled={job.busy} onclick={() => apply(file)} data-testid="run">{job.busy ? 'Working…' : 'Add page numbers'}</button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>
