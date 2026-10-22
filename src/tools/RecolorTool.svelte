<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import { parsePageGroups } from '../core/page-spec';
  import type { RecolorEffect } from '../engines/recolor';
  import type { RasterDpi } from '../engines/mupdf-recolor';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';

  type Mode = 'overlay' | 'raster';

  let effect = $state<RecolorEffect>('greyscale');
  let mode = $state<Mode>('overlay');
  let dpi = $state<RasterDpi>(300);
  let spec = $state('');
  let alsoClean = $state(false);
  const job = new ToolRun();

  /** 0-based pages in order; an empty box means every page. */
  function parsePages(file: PdfFile): number[] {
    if (!spec.trim()) return [];
    const parsed = parsePageGroups(spec, file.pages);
    if (!parsed.ok) throw new Error(parsed.error);
    return [...new Set(parsed.groups.flat())].sort((a, b) => a - b);
  }

  function apply(file: PdfFile) {
    job.run(async () => {
      const pages = parsePages(file);
      const out =
        mode === 'overlay'
          ? await runPdfJob({ op: 'recolorOverlay', file: copyBytes(file.bytes), opts: { effect, pages } })
          : await runMupdfJob({ op: 'recolorRaster', file: copyBytes(file.bytes), opts: { effect, dpi: Number(dpi) as RasterDpi, pages } });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, effect === 'greyscale' ? '-greyscale' : '-inverted'));
      const count = pages.length || file.pages;
      const what = effect === 'greyscale' ? 'Made a greyscale copy of' : 'Inverted the colours of';
      const after =
        mode === 'raster'
          ? ' Those pages are now pictures: run OCR on the copy if you need to search or copy their text.'
          : '';
      return `${what} ${count} page${count === 1 ? '' : 's'}. The original file is unchanged.${after}${note}`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <fieldset>
        <legend>Effect</legend>
        <label class="check">
          <input type="radio" name="effect" value="greyscale" bind:group={effect} data-testid="effect-greyscale" />
          Greyscale: a black-and-white copy, for printing
        </label>
        <label class="check">
          <input type="radio" name="effect" value="invert" bind:group={effect} data-testid="effect-invert" />
          Invert colours: light text on a dark page, for reading at night
        </label>
      </fieldset>
      <fieldset>
        <legend>How</legend>
        <label class="check">
          <input type="radio" name="mode" value="overlay" bind:group={mode} data-testid="mode-overlay" />
          Keep text (recommended): text stays selectable and the file stays small
        </label>
        <label class="check">
          <input type="radio" name="mode" value="raster" bind:group={mode} data-testid="mode-raster" />
          Image-based: turns each page into a picture, so colour is really gone
        </label>
        {#if mode === 'overlay'}
          <p class="muted" data-testid="overlay-note">
            Adds a colour filter on top of each page. The original colours are still stored underneath, so someone
            editing the PDF could remove the filter. Comments, highlights and form fields are not changed: flatten the
            PDF first if you want them included.
          </p>
        {:else}
          <p class="warning" data-testid="raster-warning">
            Text on the changed pages can no longer be selected, searched or copied (run OCR on the result to fix that),
            links and bookmarks on them stop working, and the file is usually bigger.
          </p>
          <label class="field">Quality
            <select bind:value={dpi} data-testid="dpi">
              <option value={150}>150 dpi (smaller file)</option>
              <option value={300}>300 dpi (sharp print)</option>
            </select>
          </label>
        {/if}
      </fieldset>
      <div class="fields">
        <label class="field">Pages <input type="text" placeholder="All, or e.g. 2-5" bind:value={spec} data-testid="recolor-pages" /></label>
      </div>
      <RemoveScriptsOption bind:checked={alsoClean} />
      <div class="actions">
        <button disabled={job.busy} onclick={() => apply(file)} data-testid="run">
          {job.busy ? 'Working…' : effect === 'greyscale' ? 'Make greyscale copy' : 'Invert colours'}
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
    padding: 8px 12px 10px;
    margin: 0 0 12px;
  }
  legend {
    font-weight: 600;
    padding: 0 4px;
  }
  .warning {
    color: var(--bad);
    font-size: 14px;
  }
</style>
