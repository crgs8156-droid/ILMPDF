<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import Thumb from '../lib/Thumb.svelte';
  import Notice from '../lib/Notice.svelte';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import { closePdf, openPdf } from '../engines/pdfjs';
  import { findBlankPages, type Sensitivity } from '../engines/blank-pages';

  type Props = { file: PdfFile };
  let { file }: Props = $props();

  let sensitivity = $state<Sensitivity>('normal');
  let doc = $state<PDFDocumentProxy | null>(null);
  let checked = $state(0);
  /** Pages found blank; `remove` is the tick the user can take off to keep one. */
  let found = $state<{ index: number; remove: boolean }[] | null>(null);
  let alsoClean = $state(false);
  const scan = new ToolRun();
  const job = new ToolRun();

  let closed = false;
  onDestroy(() => {
    closed = true;
    void closePdf(doc);
  });

  const removing = $derived(found ? found.filter((f) => f.remove).length : 0);

  function findBlanks() {
    found = null;
    job.errors = [];
    job.done = [];
    scan.run(async () => {
      if (!doc) {
        const opened = await openPdf(file.bytes);
        if (closed) {
          void closePdf(opened);
          return;
        }
        doc = opened;
      }
      checked = 0;
      const blank = await findBlankPages(doc, sensitivity, (n) => (checked = n));
      found = blank.map((index) => ({ index, remove: true }));
      if (blank.length === 0) return 'No blank pages found. Try "Also near-blank scans" if you expected some.';
      if (blank.length === file.pages) return 'Every page looks blank. Untick the pages you want to keep.';
    });
  }

  function removeBlanks() {
    job.run(async () => {
      const drop = new Set(found!.filter((f) => f.remove).map((f) => f.index));
      if (drop.size === file.pages) throw new Error('Keep at least one page: untick a page to keep it.');
      const plan = Array.from({ length: file.pages }, (_, index) => index)
        .filter((index) => !drop.has(index))
        .map((index) => ({ index, rotate: 0 as const }));
      const out = await runPdfJob({ op: 'organize', file: copyBytes(file.bytes), plan });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-no-blanks'));
      return `Removed ${drop.size} blank page${drop.size === 1 ? '' : 's'}; ${plan.length} left.${note}`;
    });
  }
</script>

<div class="panel">
  <div class="fields">
    <label class="field">What counts as blank
      <select bind:value={sensitivity} data-testid="blank-sensitivity">
        <option value="strict">Only completely empty pages</option>
        <option value="normal">Empty or a few stray marks</option>
        <option value="scans">Also near-blank scans (specks, dark edges)</option>
      </select>
    </label>
  </div>
  <div class="actions">
    <button disabled={scan.busy || job.busy} onclick={findBlanks} data-testid="find-blank">
      {scan.busy ? `Checking page ${checked} of ${file.pages}…` : 'Find blank pages'}
    </button>
  </div>
</div>
<Notice messages={scan.errors} />
<Notice kind="info" messages={scan.done} />

{#if found && found.length > 0 && doc}
  <p class="muted">Ticked pages will be removed. Untick any page you want to keep.</p>
  <ul class="grid">
    {#each found as page (page.index)}
      <li class="card" class:keep={!page.remove} data-testid="blank-card" data-index={page.index}>
        <Thumb {doc} pageNumber={page.index + 1} />
        <label class="check"><input type="checkbox" bind:checked={page.remove} data-testid="blank-remove" /> Remove page {page.index + 1}</label>
      </li>
    {/each}
  </ul>
  <RemoveScriptsOption bind:checked={alsoClean} />
  <div class="actions">
    <button disabled={job.busy || removing === 0} onclick={removeBlanks} data-testid="run">
      {job.busy ? 'Working…' : `Remove ${removing} page${removing === 1 ? '' : 's'}`}
    </button>
  </div>
{/if}
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
    gap: 12px;
  }
  .card {
    display: grid;
    gap: 8px;
    padding: 10px;
    background: var(--surface);
    border: 2px solid var(--accent);
    border-radius: 10px;
  }
  .card.keep {
    border-color: var(--border);
    opacity: 0.7;
  }
</style>
