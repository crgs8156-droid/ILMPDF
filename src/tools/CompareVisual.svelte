<script lang="ts">
  import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { closePdf, openPdf, pagePixels } from '../engines/pdfjs';
  import { diffPixels, type Pixels } from '../core/pixel-diff';

  type Props = { older: PdfFile; newer: PdfFile };
  let { older, newer }: Props = $props();

  // Both files are drawn at this exact width, so their pixels line up.
  const PIXEL_WIDTH = 900;

  let docs = $state<{ a: PDFDocumentProxy; b: PDFDocumentProxy } | null>(null);
  let errors = $state<string[]>([]);
  let page = $state(1);
  let mode = $state<'highlight' | 'side'>('highlight');
  let status = $state('');
  let busy = $state(false);
  let diffCanvas = $state<HTMLCanvasElement>();
  let canvasA = $state<HTMLCanvasElement>();
  let canvasB = $state<HTMLCanvasElement>();
  let rendered = $state<{ a: ImageData | null; b: ImageData | null; diff: Pixels | null } | null>(null);
  const total = $derived(Math.max(older.pages, newer.pages));

  // Open both files with PDF.js (parsing runs in PDF.js's own worker) and
  // close them, which also stops those workers, when this view goes away.
  $effect(() => {
    let alive = true;
    let opened: PDFDocumentProxy[] = [];
    (async () => {
      try {
        opened = [await openPdf(older.bytes), await openPdf(newer.bytes)];
        if (alive) docs = { a: opened[0]!, b: opened[1]! };
        else opened.forEach((d) => void closePdf(d));
      } catch (err) {
        opened.forEach((d) => void closePdf(d));
        errors = [err instanceof Error ? err.message : 'Could not draw the pages.'];
      }
    })();
    return () => {
      alive = false;
      docs = null;
      opened.forEach((d) => void closePdf(d));
    };
  });

  // Draw and compare the current page. `token` drops results that arrive
  // after the user has already moved to another page.
  let token = 0;
  $effect(() => {
    const current = docs;
    const n = page;
    if (!current) return;
    const mine = ++token;
    busy = true;
    status = '';
    (async () => {
      try {
        const a = n <= older.pages ? await pagePixels(current.a, n, PIXEL_WIDTH) : null;
        const b = n <= newer.pages ? await pagePixels(current.b, n, PIXEL_WIDTH) : null;
        if (mine !== token) return;
        if (a && b) {
          const d = diffPixels(a, b);
          rendered = { a, b, diff: d.image };
          const pct = d.ratio * 100;
          status =
            d.changed === 0
              ? 'No visual differences on this page.'
              : `About ${pct < 0.1 ? 'less than 0.1' : pct.toFixed(1)}% of this page looks different (shown in red).`;
        } else {
          rendered = { a, b, diff: null };
          status = a ? `Only the older file has a page ${n}.` : `Only the newer file has a page ${n}.`;
        }
      } catch {
        if (mine === token) status = 'This page could not be drawn.';
      } finally {
        if (mine === token) busy = false;
      }
    })();
  });

  function paint(canvas: HTMLCanvasElement | undefined, pixels: Pixels | ImageData | null | undefined) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!pixels || !ctx) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const data = pixels instanceof ImageData ? pixels : new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    ctx.putImageData(data, 0, 0);
  }

  $effect(() => {
    if (!rendered) return;
    if (mode === 'highlight') paint(diffCanvas, rendered.diff ?? rendered.a ?? rendered.b);
    else {
      paint(canvasA, rendered.a);
      paint(canvasB, rendered.b);
    }
  });
</script>

<Notice messages={errors} />
<div class="panel" data-testid="visual">
  <div class="actions">
    <button type="button" class="quiet" disabled={page <= 1} onclick={() => page--} data-testid="prev-page">Previous</button>
    <span data-testid="page-label">Page {page} of {total}</span>
    <button type="button" class="quiet" disabled={page >= total} onclick={() => page++} data-testid="next-page">Next</button>
    <label class="field">
      View
      <select bind:value={mode} data-testid="visual-mode">
        <option value="highlight">Differences in red</option>
        <option value="side">Side by side</option>
      </select>
    </label>
  </div>
  <p data-testid="visual-status" aria-live="polite">{busy && !status ? 'Drawing…' : status}</p>
  {#if mode === 'highlight'}
    <canvas bind:this={diffCanvas} class="page" data-testid="diff-canvas"></canvas>
  {:else}
    <div class="side">
      <figure>
        <figcaption class="muted">Older</figcaption>
        <canvas bind:this={canvasA} class="page"></canvas>
      </figure>
      <figure>
        <figcaption class="muted">Newer</figcaption>
        <canvas bind:this={canvasB} class="page"></canvas>
      </figure>
    </div>
  {/if}
</div>

<style>
  .page {
    width: 100%;
    height: auto;
    border: 1px solid var(--border);
    background: #fff;
  }
  .side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  figure {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  p {
    margin: 0;
  }
</style>
