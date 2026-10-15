<script lang="ts">
  import { onMount } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { renderPage } from '../engines/pdfjs';

  type Props = { doc: PDFDocumentProxy; pageNumber: number; rotation?: number; width?: number };
  let { doc, pageNumber, rotation = 0, width = 132 }: Props = $props();

  let canvas: HTMLCanvasElement;
  let visible = $state(false);
  let failed = $state(false);

  // Render only once the thumbnail scrolls into view.
  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible = true;
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(canvas);
    return () => io.disconnect();
  });

  $effect(() => {
    if (!visible) return;
    failed = false;
    renderPage(doc, pageNumber, canvas, width, rotation).catch(() => (failed = true));
  });
</script>

<div class="thumb">
  <canvas bind:this={canvas} aria-label={`Page ${pageNumber}`}></canvas>
  {#if failed}<span class="err">Preview unavailable</span>{/if}
</div>

<style>
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 120px;
  }
  canvas {
    max-width: 100%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  }
  .err {
    position: absolute;
    font-size: 12px;
    color: var(--muted);
  }
</style>
