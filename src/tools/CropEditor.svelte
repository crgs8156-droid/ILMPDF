<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { closePdf, openPdf, renderPage } from '../engines/pdfjs';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import type { CropBox } from '../engines/pdflib-ops';

  type Props = { file: PdfFile };
  let { file }: Props = $props();
  // The parent re-creates this component for each new file.
  const initial = untrack(() => file);

  let doc = $state<PDFDocumentProxy | null>(null);
  let previewError = $state<string[]>([]);
  let pageIndex = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let boxEl = $state<HTMLDivElement>();
  let pageEl = $state<HTMLDivElement>();
  // True once the current page has finished drawing, so the frame matches it.
  let rendered = $state(false);

  // The area to keep, as fractions of the page as shown.
  const START: CropBox = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  let box = $state<CropBox>({ ...START });
  let scope = $state<'page' | 'all'>('all');
  let dragFrom: [number, number] | null = null;
  const job = new ToolRun();

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
  });

  $effect(() => {
    if (!doc || !canvas) return;
    rendered = false;
    renderPage(doc, pageIndex + 1, canvas, 520)
      .then(() => (rendered = true))
      .catch(() => (previewError = ['Preview unavailable for this page.']));
  });

  // Draw the crop frame through the style object (CSSOM); the production CSP
  // blocks inline style attributes, but not this.
  $effect(() => {
    if (!boxEl) return;
    boxEl.style.left = `${box.x * 100}%`;
    boxEl.style.top = `${box.y * 100}%`;
    boxEl.style.width = `${box.width * 100}%`;
    boxEl.style.height = `${box.height * 100}%`;
  });

  // Measures against the preview element itself rather than the event's
  // target, which differs between browsers while the pointer is captured.
  function fraction(e: PointerEvent): [number, number] {
    const r = pageEl!.getBoundingClientRect();
    const clampUnit = (n: number) => Math.min(1, Math.max(0, n));
    return [clampUnit((e.clientX - r.left) / r.width), clampUnit((e.clientY - r.top) / r.height)];
  }

  // Dragging on the page draws a new frame from corner to corner. The frame
  // follows the pointer while it moves and is set once more where it is let
  // go, in case a browser sends few or no move events.
  function drag(e: PointerEvent) {
    if (!dragFrom || !rendered || !pageEl) return;
    const [fx, fy] = fraction(e);
    const [sx, sy] = dragFrom;
    if (Math.abs(fx - sx) < 0.02 || Math.abs(fy - sy) < 0.02) return; // too small to mean anything yet
    box = { x: Math.min(sx, fx), y: Math.min(sy, fy), width: Math.abs(fx - sx), height: Math.abs(fy - sy) };
  }

  const percent = (n: number) => `${Math.round(n * 100)}%`;

  function crop() {
    const pages = scope === 'all' ? [] : [pageIndex];
    const chosen = { ...box };
    job.run(async () => {
      const out = await runPdfJob({ op: 'crop', file: copyBytes(initial.bytes), box: chosen, pages });
      saveBytes(out.files![0]!, safeFileName(initial.name, '-cropped'));
      return `Saved a cropped copy (${scope === 'all' ? 'every page' : `page ${pageIndex + 1}`}).`;
    });
  }
</script>

<div class="panel">
  <p class="muted">Drag across the page to draw the area to keep. Everything outside the frame is cropped away.</p>
  <div class="controls">
    <button type="button" class="quiet" disabled={pageIndex === 0} onclick={() => (pageIndex -= 1)}>‹ Previous</button>
    <span data-testid="page-label">Page {pageIndex + 1} of {initial.pages}</span>
    <button type="button" class="quiet" disabled={pageIndex >= initial.pages - 1} onclick={() => (pageIndex += 1)} data-testid="next-page">Next ›</button>
    <button type="button" class="quiet reset" onclick={() => (box = { ...START })}>Reset frame</button>
  </div>
  <Notice messages={previewError} />
  <div
    class="page"
    role="presentation"
    bind:this={pageEl}
    onpointerdown={(e) => {
      if (!rendered || !pageEl) return;
      pageEl.setPointerCapture(e.pointerId);
      dragFrom = fraction(e);
    }}
    onpointermove={drag}
    onpointerup={(e) => {
      drag(e);
      dragFrom = null;
    }}
    onpointercancel={() => (dragFrom = null)}
    data-testid="page-preview"
    data-ready={rendered}
  >
    <canvas bind:this={canvas}></canvas>
    <div class="frame" bind:this={boxEl}></div>
  </div>
  <p class="muted size" data-testid="crop-size">
    Keeping {percent(box.width)} of the width and {percent(box.height)} of the height.
  </p>
  <fieldset>
    <legend>Crop</legend>
    <label class="check"><input type="radio" name="scope" value="all" bind:group={scope} data-testid="scope-all" /> Every page</label>
    <label class="check"><input type="radio" name="scope" value="page" bind:group={scope} data-testid="scope-page" /> Only this page</label>
  </fieldset>
  <p class="muted">
    Cropping hides the rest of the page, but the hidden part is still inside the file. To remove something for good,
    use redaction (coming in Phase 3).
  </p>
  <div class="actions">
    <button type="button" disabled={job.busy} onclick={crop} data-testid="run">{job.busy ? 'Cropping…' : 'Crop PDF'}</button>
  </div>
</div>
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .reset {
    margin-left: auto;
  }
  .page {
    position: relative;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .page canvas {
    display: block;
    max-width: 100%;
    background: #fff;
  }
  .frame {
    position: absolute;
    border: 2px solid var(--accent);
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.45);
    pointer-events: none;
  }
  .size {
    text-align: center;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px 12px;
    margin: 12px 0;
    display: grid;
    gap: 6px;
  }
  legend {
    color: var(--muted);
    font-size: 13px;
    padding: 0 4px;
  }
</style>
