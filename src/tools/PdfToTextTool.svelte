<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';

  let markPages = $state(true);
  // The pages of the last run, kept only in memory so they can be saved again.
  let result = $state<{ pages: string[]; name: string } | null>(null);
  const text = $derived(result ? join(result.pages) : '');
  const job = new ToolRun();

  function join(pages: string[]): string {
    if (!markPages) return pages.join('\n\n');
    return pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n');
  }

  function save() {
    if (!result) return;
    saveBytes(new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' }), result.name);
  }

  function extract(file: PdfFile) {
    result = null;
    job.run(async () => {
      const out = await runMupdfJob({ op: 'extractText', file: copyBytes(file.bytes) });
      const { pages, chars } = out.text!;
      if (chars === 0) {
        return 'No text was found. This PDF is probably scanned (pictures of pages), which needs text recognition (OCR) to read.';
      }
      result = { pages, name: safeFileName(file.name, '', '.txt') };
      save();
      return `Saved the text of ${pages.length === 1 ? '1 page' : `${pages.length} pages`} as a .txt file. A preview is below.`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <label class="check">
        <input type="checkbox" bind:checked={markPages} data-testid="mark-pages" />
        Mark where each page starts ("--- Page 1 ---")
      </label>
      <p class="muted">
        Works for PDFs made from documents. Scanned pages are pictures of text, so they give no text. Columns and tables
        may come out in a different order than they look.
      </p>
      <div class="actions">
        <button type="button" disabled={job.busy} onclick={() => extract(file)} data-testid="run">
          {job.busy ? 'Reading…' : 'Extract text'}
        </button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
    {#if result}
      <div class="panel">
        <label class="preview">
          <span class="muted">Preview</span>
          <textarea readonly rows="16" value={text} data-testid="text-preview"></textarea>
        </label>
        <div class="actions">
          <button type="button" class="quiet" onclick={save}>Save again</button>
        </div>
      </div>
    {/if}
  {/snippet}
</SinglePdf>

<style>
  .preview {
    display: grid;
    gap: 6px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    resize: vertical;
  }
</style>
