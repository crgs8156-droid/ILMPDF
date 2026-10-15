<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import { loadImages, move, type ImageFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { formatBytes } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import type { PageSize } from '../engines/pdflib-ops';

  let images = $state<ImageFile[]>([]);
  let rejected = $state<string[]>([]);
  let size = $state<PageSize>('a4');
  let margin = $state(0);
  const job = new ToolRun();

  async function add(list: File[]) {
    const { ok, rejected: bad } = await loadImages(list);
    images = [...images, ...ok].slice(0, 200);
    rejected = bad.map((r) => `${r.name}: ${r.reason}`);
  }

  function convert() {
    job.run(async () => {
      const out = await runPdfJob({
        op: 'imagesToPdf',
        images: images.map((i) => ({ bytes: copyBytes(i.bytes), kind: i.kind })),
        size,
        margin: Math.max(0, Math.min(144, Number(margin) || 0)),
      });
      saveBytes(out.files![0]!, 'images.pdf');
      return `Created a ${images.length}-page PDF. Saved images.pdf.`;
    });
  }
</script>

<FilePicker
  onFiles={add}
  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.gif"
  title={images.length ? 'Add more images' : 'Drop images here'}
  hint="JPG, PNG, HEIC, WebP or GIF. One image per page."
  compact={images.length > 0}
/>
<Notice messages={rejected} />

{#if images.length > 0}
  <ol class="list" data-testid="image-list">
    {#each images as img, i (img.key)}
      <li>
        <div class="meta">
          <div class="name">{i + 1}. {img.name}</div>
          <div class="detail">{img.kind.toUpperCase()} · {formatBytes(img.size)}</div>
        </div>
        <div class="actions">
          <button class="quiet icon" aria-label="Move up" disabled={i === 0} onclick={() => (images = move(images, i, i - 1))}>↑</button>
          <button class="quiet icon" aria-label="Move down" disabled={i === images.length - 1} onclick={() => (images = move(images, i, i + 1))}>↓</button>
          <button class="quiet icon" aria-label="Remove" onclick={() => (images = images.filter((x) => x.key !== img.key))}>✕</button>
        </div>
      </li>
    {/each}
  </ol>
  <div class="panel">
    <div class="fields">
      <label class="field">Page size
        <select bind:value={size}>
          <option value="a4">A4</option>
          <option value="letter">US Letter</option>
          <option value="fit">Same as image</option>
        </select>
      </label>
      <label class="field">Margin (points)
        <input type="number" min="0" max="144" bind:value={margin} />
      </label>
    </div>
    <div class="actions">
      <button disabled={job.busy} onclick={convert} data-testid="run">{job.busy ? 'Converting…' : 'Create PDF'}</button>
    </div>
  </div>
{/if}
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />
