<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { parsePageGroups } from '../core/page-spec';
  import { closePdf, openPdf, pageToImage } from '../engines/pdfjs';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';

  let format = $state<'image/png' | 'image/jpeg'>('image/png');
  let dpi = $state(150);
  let spec = $state('');
  let progress = $state('');
  const job = new ToolRun();

  function convert(file: PdfFile) {
    job.run(async () => {
      const parsed = spec.trim() ? parsePageGroups(spec, file.pages) : { ok: true as const, groups: [Array.from({ length: file.pages }, (_, i) => i)] };
      if (!parsed.ok) throw new Error(parsed.error);
      const pages = [...new Set(parsed.groups.flat())];
      const doc = await openPdf(file.bytes);
      const ext = format === 'image/png' ? 'png' : 'jpg';
      const base = safeFileName(file.name).replace(/\.pdf$/, '');
      try {
        for (const [n, index] of pages.entries()) {
          progress = `Page ${n + 1} of ${pages.length}…`;
          const blob = await pageToImage(doc, index + 1, format, dpi);
          saveBytes(blob, `${base}-page-${index + 1}.${ext}`);
        }
      } finally {
        progress = '';
        await closePdf(doc);
      }
      return `Saved ${pages.length} image${pages.length === 1 ? '' : 's'}.`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <div class="fields">
        <label class="field">Format
          <select bind:value={format} data-testid="img-format">
            <option value="image/png">PNG (sharp, larger)</option>
            <option value="image/jpeg">JPG (smaller)</option>
          </select>
        </label>
        <label class="field">Resolution
          <select bind:value={dpi}>
            <option value={72}>72 dpi (screen)</option>
            <option value={150}>150 dpi</option>
            <option value={300}>300 dpi (print)</option>
          </select>
        </label>
        <label class="field">Pages (blank = all)
          <input type="text" bind:value={spec} placeholder={`e.g. 1-${Math.min(3, file.pages)}`} data-testid="img-pages" />
        </label>
      </div>
      <div class="actions">
        <button disabled={job.busy} onclick={() => convert(file)} data-testid="run">{job.busy ? 'Converting…' : 'Convert to images'}</button>
        <span class="muted">{progress}</span>
      </div>
      <p class="muted">Safari may ask once to allow several downloads.</p>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>
