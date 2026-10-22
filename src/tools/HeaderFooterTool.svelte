<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import { parsePageGroups } from '../core/page-spec';
  import { batesLabel, fillTemplate, localDate, SLOTS, type Slot } from '../core/header-text';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';

  const LABELS: Record<Slot, string> = {
    'top-left': 'Top left',
    'top-center': 'Top centre',
    'top-right': 'Top right',
    'bottom-left': 'Bottom left',
    'bottom-center': 'Bottom centre',
    'bottom-right': 'Bottom right',
  };

  // A useful starting point: the file name at the top, "Page 1 of 9" at the bottom.
  let texts = $state<Record<Slot, string>>({
    'top-left': '{file}',
    'top-center': '',
    'top-right': '{date}',
    'bottom-left': '',
    'bottom-center': 'Page {page} of {total}',
    'bottom-right': '',
  });
  let fontSize = $state(10);
  let margin = $state(24);
  let spec = $state('');
  let prefix = $state('');
  let suffix = $state('');
  let batesStart = $state(1);
  let digits = $state(6);
  let alsoClean = $state(false);
  const job = new ToolRun();
  const date = localDate();

  const bates = $derived({ prefix, suffix, start: Number(batesStart), digits: Number(digits) });
  const usesBates = $derived(SLOTS.some((s) => /\{bates\}/i.test(texts[s])));

  function baseName(file: PdfFile): string {
    return file.name.replace(/\.pdf$/i, '');
  }

  /** What the first stamped page will say, shown before running. */
  function preview(file: PdfFile, slot: Slot): string {
    const first = parsePages(file)[0] ?? 0;
    return fillTemplate(texts[slot], {
      page: first + 1,
      total: file.pages,
      file: baseName(file),
      date,
      bates: batesLabel(bates, bates.start),
    });
  }

  /** 0-based pages in order; an empty box means every page. */
  function parsePages(file: PdfFile): number[] {
    if (!spec.trim()) return [];
    const parsed = parsePageGroups(spec, file.pages);
    if (!parsed.ok) return [];
    return [...new Set(parsed.groups.flat())].sort((a, b) => a - b);
  }

  function apply(file: PdfFile) {
    job.run(async () => {
      if (spec.trim()) {
        const parsed = parsePageGroups(spec, file.pages);
        if (!parsed.ok) throw new Error(parsed.error);
      }
      const pages = parsePages(file);
      const out = await runPdfJob({
        op: 'headerFooter',
        file: copyBytes(file.bytes),
        opts: {
          texts: { ...texts },
          fontSize: Number(fontSize),
          margin: Number(margin),
          pages,
          fileName: baseName(file),
          date,
          bates: { ...bates },
        },
      });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-stamped'));
      const count = pages.length || file.pages;
      return `Added headers and footers to ${count} page${count === 1 ? '' : 's'}.${note}`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <p class="muted">
        Codes you can type: {'{page}'}, {'{total}'}, {'{date}'}, {'{file}'} and {'{bates}'}. Leave a box empty to skip it.
      </p>
      <div class="slots">
        {#each SLOTS as slot (slot)}
          <label class="field">{LABELS[slot]}
            <input type="text" maxlength="200" bind:value={texts[slot]} data-testid={`hf-${slot}`} />
            <span class="preview muted" data-testid={`hf-preview-${slot}`}>{preview(file, slot)}</span>
          </label>
        {/each}
      </div>
      <div class="fields">
        <label class="field">Pages <input type="text" placeholder="All, or e.g. 2-" bind:value={spec} data-testid="hf-pages" /></label>
        <label class="field">Text size <input type="number" min="6" max="48" bind:value={fontSize} /></label>
        <label class="field">Margin (points) <input type="number" min="6" max="144" bind:value={margin} /></label>
      </div>
      <fieldset class="bates" class:off={!usesBates}>
        <legend>Bates numbers {usesBates ? '' : '(type {bates} in a box to use them)'}</legend>
        <div class="fields">
          <label class="field">Prefix <input type="text" maxlength="40" placeholder="ABC" bind:value={prefix} data-testid="hf-prefix" /></label>
          <label class="field">Start at <input type="number" min="0" bind:value={batesStart} data-testid="hf-start" /></label>
          <label class="field">Digits <input type="number" min="1" max="12" bind:value={digits} data-testid="hf-digits" /></label>
          <label class="field">Suffix <input type="text" maxlength="40" bind:value={suffix} /></label>
        </div>
      </fieldset>
      <RemoveScriptsOption bind:checked={alsoClean} />
      <div class="actions">
        <button disabled={job.busy} onclick={() => apply(file)} data-testid="run">{job.busy ? 'Working…' : 'Add headers & footers'}</button>
      </div>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>

<style>
  .slots {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px 14px;
    margin-bottom: 12px;
  }
  @media (max-width: 640px) {
    .slots {
      grid-template-columns: 1fr;
    }
  }
  .preview {
    /* Keeps a line's height even when empty, so the boxes stay lined up. */
    display: block;
    min-height: 18px;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bates {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 12px 0;
  }
  .bates.off {
    opacity: 0.7;
  }
</style>
