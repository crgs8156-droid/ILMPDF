<script lang="ts">
  // A box to draw a signature in with a mouse, trackpad, finger or pen.
  // The drawing stays in this page's memory only.
  import { onMount } from 'svelte';

  type Props = { onDone: (png: Uint8Array) => void };
  let { onDone }: Props = $props();

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let empty = $state(true);
  let error = $state('');

  onMount(() => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  });

  function point(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function down(e: PointerEvent) {
    if (!ctx) return;
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1); // so a single tap leaves a dot
    ctx.stroke();
    empty = false;
    error = '';
  }

  function move(e: PointerEvent) {
    if (!drawing || !ctx) return;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function up() {
    drawing = false;
  }

  function clear() {
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    empty = true;
  }

  /** Crops to the ink (plus a small margin) and returns a transparent PNG. */
  async function done() {
    if (!ctx) return;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let [minX, minY, maxX, maxY] = [width, height, -1, -1];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      error = 'Draw your signature first.';
      return;
    }
    const pad = 6;
    const [sx, sy] = [Math.max(0, minX - pad), Math.max(0, minY - pad)];
    const [sw, sh] = [Math.min(width, maxX + pad + 1) - sx, Math.min(height, maxY + pad + 1) - sy];
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) {
      error = 'Could not save the drawing. Please try again.';
      return;
    }
    onDone(new Uint8Array(await blob.arrayBuffer()));
  }
</script>

<div class="pad">
  <canvas
    bind:this={canvas}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    aria-label="Signature drawing area"
    data-testid="signature-pad"
  ></canvas>
  <span class="line" aria-hidden="true"></span>
</div>
{#if error}<p class="warn">{error}</p>{/if}
<div class="actions">
  <button type="button" class="quiet" onclick={clear} disabled={empty}>Clear</button>
  <button type="button" onclick={done} disabled={empty} data-testid="use-drawing">Use this signature</button>
</div>

<style>
  .pad {
    position: relative;
  }
  canvas {
    display: block;
    width: 100%;
    height: 180px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 8px;
    touch-action: none;
    cursor: crosshair;
  }
  .line {
    position: absolute;
    left: 24px;
    right: 24px;
    bottom: 40px;
    border-bottom: 1px dashed #bbb;
    pointer-events: none;
  }
  .warn {
    color: var(--danger, #b42318);
    font-size: 14px;
    margin: 4px 0;
  }
</style>
