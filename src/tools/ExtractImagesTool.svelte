<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { parsePageGroups } from '../core/page-spec';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { MAX_IMAGES } from '../core/limits';

  let spec = $state('');
  let skipTiny = $state(true);
  const job = new ToolRun();

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function extract(file: PdfFile) {
    job.run(async () => {
      const all = Array.from({ length: file.pages }, (_, i) => i);
      const parsed = spec.trim() ? parsePageGroups(spec, file.pages) : { ok: true as const, groups: [all] };
      if (!parsed.ok) throw new Error(parsed.error);
      const pages = [...new Set(parsed.groups.flat())];

      const out = await runMupdfJob({ op: 'extractImages', file: copyBytes(file.bytes), opts: { pages, skipTiny } });
      const report = out.extracted!;
      const files = out.files ?? [];
      const base = safeFileName(file.name).replace(/\.pdf$/, '');
      report.images.forEach((img, i) => {
        const type = img.ext === 'jpg' ? 'image/jpeg' : 'image/png';
        saveBytes(files[i]!, `${base}-p${img.page + 1}-img${img.index}.${img.ext}`, type);
      });

      const notes: string[] = [];
      if (report.tiny) notes.push(`skipped ${plural(report.tiny, 'tiny image')}`);
      if (report.repeats) notes.push(`${plural(report.repeats, 'repeat')} of an image already saved`);
      if (report.failed) notes.push(`${plural(report.failed, 'image')} could not be read`);
      const extra = notes.length ? ` (${notes.join('; ')})` : '';
      const limit = report.truncated ? ` Stopped at ILMPDF's limit of ${MAX_IMAGES} images: choose fewer pages to get the rest.` : '';
      if (!report.images.length) {
        return report.tiny
          ? `No images saved: the only pictures are tiny${extra}. Untick "Skip tiny images" to save them.`
          : `No images found on ${pages.length === file.pages ? 'any page' : 'these pages'}${extra}.`;
      }
      const jpg = report.images.filter((i) => i.ext === 'jpg').length;
      const kinds = [jpg && `${jpg} JPG`, report.images.length - jpg && `${report.images.length - jpg} PNG`].filter(Boolean).join(', ');
      return `Saved ${plural(report.images.length, 'image')}: ${kinds}${extra}.${limit}`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <p class="muted">
        Saves the pictures stored inside the PDF at their original quality. Photos stored as JPEG are copied unchanged;
        other pictures are saved as PNG, keeping any transparency. To save whole pages instead, use PDF to images.
      </p>
      <div class="fields">
        <label class="field">Pages (blank = all)
          <input type="text" bind:value={spec} placeholder={`e.g. 1-${Math.min(3, file.pages)}`} data-testid="extract-pages" />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={skipTiny} data-testid="skip-tiny" />
        Skip tiny images (smaller than 32 × 32 pixels, such as icons)
      </label>
      <div class="actions">
        <button disabled={job.busy} onclick={() => extract(file)} data-testid="run">{job.busy ? 'Extracting…' : 'Extract images'}</button>
      </div>
      <p class="muted">Each image downloads as its own file. Safari may ask once to allow several downloads.</p>
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>
