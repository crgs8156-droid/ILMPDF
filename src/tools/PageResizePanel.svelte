<script lang="ts">
  import Notice from '../lib/Notice.svelte';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import type { PdfFile } from '../core/files';
  import { parsePageGroups } from '../core/page-spec';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import { MM, PAPER, type Paper, type ResizeOptions } from '../engines/pagetools-ops';

  type Props = { file: PdfFile };
  let { file }: Props = $props();

  let paper = $state<Paper | 'custom'>('a4');
  let customW = $state(210);
  let customH = $state(297);
  let orientation = $state<ResizeOptions['orientation']>('auto');
  let marginMm = $state(0);
  let spec = $state('');
  let alsoClean = $state(false);
  const job = new ToolRun();

  function resize() {
    job.run(async () => {
      let pages: number[] = [];
      if (spec.trim()) {
        const parsed = parsePageGroups(spec, file.pages);
        if (!parsed.ok) throw new Error(parsed.error);
        pages = parsed.groups.flat();
      }
      const [width, height] = paper === 'custom' ? [Number(customW) * MM, Number(customH) * MM] : PAPER[paper];
      if (!(width >= 72 && height >= 72)) throw new Error('Pages must be at least 26 mm (1 inch) on each side.');
      const out = await runPdfJob({
        op: 'resize',
        file: copyBytes(file.bytes),
        opts: { width, height, orientation, margin: Number(marginMm) * MM, pages },
      });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-resized'));
      const count = pages.length ? new Set(pages).size : file.pages;
      return `Resized ${count} page${count === 1 ? '' : 's'}.${note}`;
    });
  }
</script>

<div class="panel">
  <div class="fields">
    <label class="field">Paper size
      <select bind:value={paper} data-testid="resize-paper">
        <option value="a4">A4 (210 × 297 mm)</option>
        <option value="letter">US Letter (8.5 × 11 in)</option>
        <option value="legal">US Legal (8.5 × 14 in)</option>
        <option value="a3">A3 (297 × 420 mm)</option>
        <option value="a5">A5 (148 × 210 mm)</option>
        <option value="custom">Custom size</option>
      </select>
    </label>
    {#if paper === 'custom'}
      <label class="field">Width (mm) <input type="number" min="26" max="5000" bind:value={customW} data-testid="resize-width" /></label>
      <label class="field">Height (mm) <input type="number" min="26" max="5000" bind:value={customH} data-testid="resize-height" /></label>
    {/if}
    <label class="field">Orientation
      <select bind:value={orientation} data-testid="resize-orientation">
        <option value="auto">Same as each page</option>
        <option value="portrait">Portrait (upright)</option>
        <option value="landscape">Landscape (sideways)</option>
      </select>
    </label>
    <label class="field">Margin (mm) <input type="number" min="0" max="100" bind:value={marginMm} data-testid="resize-margin" /></label>
    <label class="field">Pages (empty = all)
      <input type="text" bind:value={spec} placeholder={`e.g. 1-3, ${file.pages}`} data-testid="resize-pages" />
    </label>
  </div>
  <p class="muted">Each page's content is scaled to fit the new size and centred. Text stays selectable, and links and form fields move with it.</p>
  <RemoveScriptsOption bind:checked={alsoClean} />
  <div class="actions">
    <button disabled={job.busy} onclick={resize} data-testid="run">{job.busy ? 'Working…' : 'Resize pages'}</button>
  </div>
</div>
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />
