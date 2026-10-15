<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';

  let text = $state('CONFIDENTIAL');
  let fontSize = $state(60);
  let opacity = $state(20);
  let diagonal = $state(true);
  const job = new ToolRun();

  function apply(file: PdfFile) {
    job.run(async () => {
      const out = await runPdfJob({
        op: 'watermark',
        file: copyBytes(file.bytes),
        opts: { text, fontSize: Number(fontSize), opacity: Number(opacity) / 100, diagonal },
      });
      saveBytes(out.files![0]!, safeFileName(file.name, '-watermarked'));
      return `Watermarked ${file.pages} pages.`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <div class="fields">
        <label class="field">Text <input type="text" maxlength="200" bind:value={text} data-testid="wm-text" /></label>
        <label class="field">Text size <input type="number" min="8" max="200" bind:value={fontSize} /></label>
        <label class="field">Opacity % <input type="number" min="5" max="100" bind:value={opacity} /></label>
        <label class="check"><input type="checkbox" bind:checked={diagonal} /> Diagonal</label>
      </div>
      <p class="muted">Uses the built-in Helvetica font, which covers English letters, digits and basic punctuation.</p>
      <div class="actions">
        <button disabled={job.busy} onclick={() => apply(file)} data-testid="run">{job.busy ? 'Working…' : 'Add watermark'}</button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>
