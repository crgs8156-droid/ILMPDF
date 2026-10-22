<script lang="ts">
  // The Drag Wheel: when a file is dragged onto the home page, a ring of
  // one-step actions appears under the cursor. Dropping on a slice runs that
  // action on the PDF and saves the result as a new download; dropping
  // anywhere else does nothing. The file is read only after the drop.
  import Notice from './Notice.svelte';
  import { loadPdfs } from '../core/files';
  import { BUSY_TEXT, runQuick } from '../core/quick-actions';
  import { QUICK_SLICES, clampCentre, hitTest, sliceCentre, slicePath, wheelSize, type Hit } from '../core/wheel';

  type Props = { enabled: boolean };
  let { enabled }: Props = $props();

  const slices = QUICK_SLICES;
  /** How far the hovered slice slides outwards, in pixels. */
  const LIFT = 7;

  let open = $state(false);
  let running = $state<number | null>(null);
  let busyText = $state('');
  let hot = $state<Hit>(null);
  let centre = $state({ x: 0, y: 0 });
  let size = $state({ outer: 150, inner: 57 });
  let many = $state(false);
  let done = $state<string[]>([]);
  let errors = $state<string[]>([]);
  let wheel = $state<SVGSVGElement>();
  let parts = $state<SVGGElement[]>([]);
  // dragenter and dragleave fire for every element the cursor crosses, so
  // the wheel closes only when the count of entered elements is back to 0.
  let depth = 0;

  const shown = $derived(open || running !== null);
  const box = $derived(2 * (size.outer + 16));
  const lit = $derived(running ?? hot);
  const hint = $derived(
    running !== null
      ? busyText
      : many
        ? 'The wheel takes one PDF at a time for now'
        : typeof hot === 'number'
          ? slices[hot]!.hint
          : 'Drop on a tool · drop anywhere else to cancel',
  );

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  const where = (e: DragEvent): Hit => hitTest(e.clientX - centre.x, e.clientY - centre.y, slices.length, size.outer, size.inner);

  function show(e: DragEvent) {
    size = wheelSize(innerWidth, innerHeight);
    centre = clampCentre(e.clientX, e.clientY, innerWidth, innerHeight, size.outer + 16);
    // Browsers reveal how many items are being dragged, but not their names, until the drop.
    many = (e.dataTransfer?.items?.length ?? 0) > 1;
    hot = null;
    done = [];
    errors = [];
    open = true;
  }

  function hide() {
    open = false;
    hot = null;
    depth = 0;
  }

  $effect(() => {
    if (!enabled) return;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (running !== null) return;
      depth++;
      if (!open) show(e);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Cancelling dragover is what allows a drop here at all.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = open ? 'copy' : 'none';
      if (open) hot = where(e);
    };
    const leave = (e: DragEvent) => {
      if (!open) return;
      depth = Math.max(0, depth - 1);
      // Leaving the window reports a point on or past its edge.
      const out = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight;
      if (depth === 0 || out) hide();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this, Safari would leave ILMPDF to show the dropped file.
      e.preventDefault();
      if (!open) return;
      const target = where(e);
      const files = Array.from(e.dataTransfer?.files ?? []);
      hide();
      if (typeof target === 'number') void run(target, files);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) hide();
    };
    addEventListener('dragenter', enter);
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    addEventListener('keydown', key);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
      removeEventListener('keydown', key);
      hide();
    };
  });

  // Positions go through CSSOM: the CSP forbids inline style attributes.
  $effect(() => {
    if (!wheel) return;
    wheel.style.setProperty('left', `${centre.x - box / 2}px`);
    wheel.style.setProperty('top', `${centre.y - box / 2}px`);
  });
  $effect(() => {
    parts.forEach((g, i) => {
      if (!g) return;
      const { angle } = sliceCentre(i, slices.length, 1);
      g.style.setProperty('--lift-x', `${Math.cos(angle) * LIFT}px`);
      g.style.setProperty('--lift-y', `${Math.sin(angle) * LIFT}px`);
    });
  });

  async function run(index: number, files: File[]) {
    const slice = slices[index]!;
    if (files.length !== 1) {
      errors = ['The wheel takes one PDF at a time for now. Drop a single file, or use Merge or Batch process for several.'];
      return;
    }
    running = index;
    busyText = BUSY_TEXT[slice.id];
    try {
      const { ok, rejected } = await loadPdfs(files);
      const file = ok[0];
      if (!file) throw new Error(rejected.map((r) => `${r.name}: ${r.reason}`).join(' ') || 'Could not read this file.');
      done = [await runQuick(slice.id, file, (step) => (busyText = `${BUSY_TEXT[slice.id]} · ${step}`))];
    } catch (err) {
      errors = [err instanceof Error ? err.message : 'Something went wrong.'];
    } finally {
      running = null;
      busyText = '';
    }
  }

  function dismiss() {
    done = [];
    errors = [];
  }
</script>

{#if shown}
  <div class="veil" class:busy={running !== null} data-testid="drop-wheel" aria-hidden="true">
    <svg
      bind:this={wheel}
      class="wheel"
      width={box}
      height={box}
      viewBox="{-box / 2} {-box / 2} {box} {box}"
      data-testid="wheel"
    >
      <circle class="disc" r={size.outer + 9} />
      {#each slices as slice, i (slice.id)}
        {@const c = sliceCentre(i, slices.length, (size.outer + size.inner) / 2)}
        <g
          bind:this={parts[i]}
          class="slice"
          class:hot={lit === i}
          class:dim={running !== null && running !== i}
          data-testid="wheel-{slice.id}"
        >
          <path class="shape" d={slicePath(i, slices.length, size.outer, size.inner)} />
          <path class="icon" d={slice.icon} transform="translate({c.x - 10} {c.y - 19}) scale(0.84)" />
          <text x={c.x} y={c.y + 15} text-anchor="middle" data-testid="wheel-label-{slice.id}">{slice.label}</text>
        </g>
      {/each}
      <circle class="hub" r={size.inner - 8} />
      {#if running !== null}
        <circle class="spin" r={size.inner - 4} pathLength="100" />
      {/if}
      <text class="hub-text" y="4" text-anchor="middle">{running !== null ? 'Working' : many ? 'One PDF' : 'ILMPDF'}</text>
    </svg>
    <p class="hint" data-testid="wheel-hint">{hint}</p>
  </div>
{/if}

{#if done.length || errors.length}
  <div class="result" aria-live="polite">
    <Notice kind="ok" messages={done} />
    <Notice messages={errors} />
    <button type="button" class="quiet icon" onclick={dismiss} aria-label="Close this note">✕</button>
  </div>
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 100;
    pointer-events: none;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(6px) saturate(1.1);
    -webkit-backdrop-filter: blur(6px) saturate(1.1);
    animation: fade 140ms ease-out backwards;
  }
  .wheel {
    position: absolute;
    overflow: visible;
    filter: drop-shadow(0 14px 32px rgb(0 0 0 / 0.22));
  }
  .disc {
    fill: color-mix(in srgb, var(--surface) 70%, transparent);
    stroke: color-mix(in srgb, var(--border) 70%, transparent);
  }
  .slice {
    transform-origin: 0 0;
    transition:
      transform 160ms cubic-bezier(0.2, 0.8, 0.3, 1.2),
      opacity 200ms;
    animation: pop 280ms cubic-bezier(0.2, 0.9, 0.3, 1.25) backwards;
  }
  .slice:nth-of-type(2) { animation-delay: 20ms; }
  .slice:nth-of-type(3) { animation-delay: 40ms; }
  .slice:nth-of-type(4) { animation-delay: 60ms; }
  .slice:nth-of-type(5) { animation-delay: 80ms; }
  .slice:nth-of-type(6) { animation-delay: 100ms; }
  .slice:nth-of-type(7) { animation-delay: 120ms; }
  .slice:nth-of-type(8) { animation-delay: 140ms; }
  .shape {
    fill: var(--surface);
    stroke: color-mix(in srgb, var(--border) 80%, transparent);
    transition: fill 120ms;
  }
  .icon {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .slice text {
    fill: var(--text);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
  }
  .slice.hot {
    transform: translate(var(--lift-x, 0), var(--lift-y, 0)) scale(1.03);
  }
  .slice.hot .shape {
    fill: var(--accent);
    stroke: var(--accent);
  }
  .slice.hot .icon {
    stroke: #fff;
  }
  .slice.hot text {
    fill: #fff;
  }
  .slice.dim {
    opacity: 0.25;
  }
  .hub {
    fill: var(--surface);
    stroke: var(--border);
  }
  .hub-text {
    fill: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
  .spin {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 28 72;
    animation: spin 900ms linear infinite;
  }
  .hint {
    position: absolute;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    margin: 0;
    max-width: calc(100% - 32px);
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 90;
    width: min(380px, calc(100% - 32px));
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: start;
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 30px rgb(0 0 0 / 0.18);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .veil,
    .slice,
    .spin {
      animation: none;
    }
    .slice {
      transition: none;
    }
  }
</style>
