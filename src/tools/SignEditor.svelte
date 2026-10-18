<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import SignaturePad from '../lib/SignaturePad.svelte';
  import { loadImages, type PdfFile } from '../core/files';
  import { closePdf, openPdf, renderPage } from '../engines/pdfjs';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import type { ImageInput, SignaturePlacement } from '../engines/pdflib-ops';

  type Props = { file: PdfFile };
  let { file }: Props = $props();
  // The parent re-creates this component for each new file.
  const initial = untrack(() => file);

  type Signature = ImageInput & { url: string; aspect: number };
  let mode = $state<'draw' | 'image'>('draw');
  let signature = $state<Signature | null>(null);
  let imageErrors = $state<string[]>([]);

  let doc = $state<PDFDocumentProxy | null>(null);
  let previewError = $state<string[]>([]);
  let pageIndex = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let sigImg = $state<HTMLImageElement>();
  let pageAspect = $state(1.414); // shown height / width, updated once rendered

  // Placement, as fractions of the page as shown: top-left corner and width.
  let x = $state(0.55);
  let y = $state(0.8);
  let width = $state(0.3);
  let everyPage = $state(false);
  let dragging = false;
  const job = new ToolRun();
  let alsoClean = $state(false);

  const heightFrac = $derived(signature ? (width * signature.aspect) / pageAspect : 0);

  let closed = false;
  openPdf(initial.bytes)
    .then((d) => {
      if (closed) void closePdf(d);
      else doc = d;
    })
    .catch((e: Error) => (previewError = [`Preview unavailable: ${e.message}`]));
  onDestroy(() => {
    closed = true;
    void closePdf(doc);
    if (signature) URL.revokeObjectURL(signature.url);
  });

  $effect(() => {
    if (!doc || !canvas) return;
    const target = canvas;
    renderPage(doc, pageIndex + 1, target, 520)
      .then(() => (pageAspect = target.height / target.width))
      .catch(() => (previewError = ['Preview unavailable for this page.']));
  });

  // Position the preview through the style object (CSSOM). The production
  // CSP blocks inline style attributes, but not this.
  $effect(() => {
    if (!sigImg) return;
    sigImg.style.left = `${x * 100}%`;
    sigImg.style.top = `${y * 100}%`;
    sigImg.style.width = `${width * 100}%`;
  });

  async function useImage(bytes: Uint8Array, kind: 'png' | 'jpg') {
    const blob = new Blob([bytes.slice()], { type: kind === 'png' ? 'image/png' : 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const aspect = bitmap.height / bitmap.width;
    bitmap.close();
    if (signature) URL.revokeObjectURL(signature.url);
    signature = { bytes, kind, url: URL.createObjectURL(blob), aspect };
    keepInside();
  }

  async function pickImage(files: File[]) {
    imageErrors = [];
    const { ok, rejected } = await loadImages(files.slice(0, 1));
    imageErrors = rejected.map((r) => `${r.name}: ${r.reason}`);
    const first = ok[0];
    if (first) await useImage(first.bytes, first.kind);
  }

  function keepInside() {
    x = Math.min(Math.max(0, x), Math.max(0, 1 - width));
    y = Math.min(Math.max(0, y), Math.max(0, 1 - heightFrac));
  }

  // Clicking or dragging on the page centres the signature on the pointer.
  function placeAt(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    x = (e.clientX - r.left) / r.width - width / 2;
    y = (e.clientY - r.top) / r.height - heightFrac / 2;
    keepInside();
  }

  function nudge(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    x += m[0];
    y += m[1];
    keepInside();
  }

  function sign() {
    if (!signature) return;
    const pages = everyPage ? Array.from({ length: initial.pages }, (_, i) => i) : [pageIndex];
    const placements: SignaturePlacement[] = pages.map((page) => ({ page, x, y, width }));
    const image: ImageInput = { bytes: copyBytes(signature.bytes), kind: signature.kind };
    job.run(async () => {
      const out = await runPdfJob({ op: 'sign', file: copyBytes(initial.bytes), image, placements });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(initial.name, '-signed'));
      return `Saved a signed copy (${pages.length === 1 ? `page ${pages[0]! + 1}` : `${pages.length} pages`}).${note}`;
    });
  }
</script>

<div class="panel">
  <h3>1. Your signature</h3>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected={mode === 'draw'} class:active={mode === 'draw'} onclick={() => (mode = 'draw')}>Draw</button>
    <button type="button" role="tab" aria-selected={mode === 'image'} class:active={mode === 'image'} onclick={() => (mode = 'image')} data-testid="tab-image">Use an image</button>
  </div>
  {#if mode === 'draw'}
    <SignaturePad onDone={(png) => useImage(png, 'png')} />
  {:else}
    <FilePicker
      multiple={false}
      compact
      accept=".png,.jpg,.jpeg,image/png,image/jpeg"
      title="Drop a signature image here"
      hint="PNG with a transparent background looks best. Files stay on this Mac."
      onFiles={pickImage}
    />
    <Notice messages={imageErrors} />
  {/if}
  {#if signature}
    <p class="muted" data-testid="signature-ready">Signature ready. You can redo it at any time.</p>
  {/if}
</div>

{#if signature}
  <div class="panel">
    <h3>2. Place it</h3>
    <p class="muted">Click or drag on the page to move the signature. Arrow keys nudge it.</p>
    <div class="controls">
      <button type="button" class="quiet" disabled={pageIndex === 0} onclick={() => (pageIndex -= 1)}>‹ Previous</button>
      <span data-testid="page-label">Page {pageIndex + 1} of {initial.pages}</span>
      <button type="button" class="quiet" disabled={pageIndex >= initial.pages - 1} onclick={() => (pageIndex += 1)} data-testid="next-page">Next ›</button>
      <label class="size">
        Size
        <input type="range" min="0.08" max="0.8" step="0.01" bind:value={width} oninput={keepInside} data-testid="size" />
      </label>
    </div>
    <Notice messages={previewError} />
    <!-- A custom control: pointer to place, arrow keys to nudge (see nudge()). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="page"
      role="application"
      aria-label="Page preview. Click to place the signature; arrow keys move it."
      tabindex="0"
      onpointerdown={(e) => {
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        placeAt(e);
      }}
      onpointermove={(e) => dragging && placeAt(e)}
      onpointerup={() => (dragging = false)}
      onpointercancel={() => (dragging = false)}
      onkeydown={nudge}
      data-testid="page-preview"
    >
      <canvas bind:this={canvas}></canvas>
      <img
        class="sig"
        src={signature.url}
        alt="Your signature"
        draggable="false"
        bind:this={sigImg}
      />
    </div>
    <label class="check every">
      <input type="checkbox" bind:checked={everyPage} data-testid="every-page" />
      Put it on every page, in the same spot
    </label>
    <p class="muted">
      This adds a picture of your signature. It is not a certified digital signature, so it doesn't prove who signed
      or lock the document.
    </p>
    <RemoveScriptsOption bind:checked={alsoClean} />
    <div class="actions">
      <button type="button" disabled={job.busy} onclick={sign} data-testid="run">{job.busy ? 'Signing…' : 'Sign PDF'}</button>
    </div>
  </div>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{/if}

<style>
  h3 {
    margin: 0 0 8px;
    font-size: 15px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }
  .tabs button {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
  }
  .tabs button.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .size {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .page {
    position: relative;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .page canvas {
    display: block;
    max-width: 100%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  }
  .page:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
  .sig {
    position: absolute;
    outline: 1px dashed var(--accent);
    pointer-events: none;
  }
  .every {
    margin-top: 12px;
  }
</style>
