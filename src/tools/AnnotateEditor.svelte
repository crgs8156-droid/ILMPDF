<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Action } from 'svelte/action';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { closePdf, openPdf, renderPage } from '../engines/pdfjs';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import { MAX_ANNOTATIONS } from '../core/limits';
  import type { AnnotKind, NewAnnotation } from '../engines/mupdf-ops';

  type Props = { file: PdfFile };
  let { file }: Props = $props();
  // The parent re-creates this component for each new file.
  const initial = untrack(() => file);

  type Rgb = [number, number, number];
  type Item = NewAnnotation & { id: number };
  type Tool = AnnotKind | 'move';

  const TOOLS: { id: Tool; label: string; hint: string }[] = [
    { id: 'text', label: 'Text box', hint: 'Type your text below, then drag on the page to draw the box it goes in.' },
    { id: 'highlight', label: 'Highlight', hint: 'Drag across the words you want to highlight.' },
    { id: 'rect', label: 'Rectangle', hint: 'Drag on the page to draw a rectangle.' },
    { id: 'line', label: 'Line', hint: 'Drag from where the line starts to where it ends.' },
    { id: 'note', label: 'Comment', hint: 'Type your comment below, then click where its note icon should go.' },
    { id: 'move', label: 'Select', hint: 'Click an item to select it, then drag to move it. Delete or Backspace removes it.' },
  ];
  const COLORS: { name: string; rgb: Rgb }[] = [
    { name: 'Yellow', rgb: [1, 0.85, 0.1] },
    { name: 'Green', rgb: [0.2, 0.75, 0.3] },
    { name: 'Blue', rgb: [0.05, 0.4, 0.85] },
    { name: 'Red', rgb: [0.85, 0.1, 0.1] },
    { name: 'Black', rgb: [0, 0, 0] },
  ];
  const NOTE_POINTS = 20; // matches the comment icon size in mupdf-ops

  let tool = $state<Tool>('text');
  // Each kind remembers its own colour (highlights yellow, text black, and so on).
  let colors = $state<Record<AnnotKind, Rgb>>({
    text: [0, 0, 0],
    highlight: [1, 0.85, 0.1],
    rect: [0.85, 0.1, 0.1],
    line: [0.85, 0.1, 0.1],
    note: [1, 0.85, 0.1],
  });
  let words = $state('');
  let fontSize = $state(14);
  let items = $state<Item[]>([]);
  let selected = $state<number | null>(null);
  let hint = $state<string[]>([]);
  let nextId = 1;

  let doc = $state<PDFDocumentProxy | null>(null);
  let previewError = $state<string[]>([]);
  let pageIndex = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let pageEl = $state<HTMLDivElement>();
  let rendered = $state(false);
  // The preview's size on screen (CSS pixels) and the page's shown size in points.
  let viewW = $state(1);
  let viewH = $state(1);
  let pagePts = $state<[number, number]>([612, 792]);
  const pxPerPt = $derived(viewW / pagePts[0]);

  // While drawing: where the drag started and where the pointer is now.
  let draft = $state<{ from: [number, number]; to: [number, number] } | null>(null);
  let moving: { id: number; from: [number, number]; start: Item } | null = null;
  const job = new ToolRun();
  let alsoClean = $state(false);

  const onPage = $derived(items.filter((i) => i.page === pageIndex));
  const current = $derived(items.find((i) => i.id === selected) ?? null);
  const kind = $derived<AnnotKind | null>(tool === 'move' ? null : tool);
  const needsWords = $derived(tool === 'text' || tool === 'note');

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
    const d = doc;
    const n = pageIndex + 1;
    rendered = false;
    renderPage(d, n, canvas, 560)
      .then(async () => {
        const page = await d.getPage(n);
        const vp = page.getViewport({ scale: 1, rotation: page.rotate });
        pagePts = [vp.width, vp.height];
        rendered = true;
      })
      .catch(() => (previewError = ['Preview unavailable for this page.']));
  });

  const css = (rgb: Rgb) => `rgb(${rgb.map((c) => Math.round(c * 255)).join(' ')})`;
  const same = (a: Rgb, b: Rgb) => a.every((c, i) => Math.abs(c - b[i]!) < 0.01);

  // Positions a text box preview through the style object (CSSOM). The
  // production CSP blocks inline style attributes, but not this.
  const place: Action<HTMLElement, { item: Item; w: number; h: number; scale: number }> = (node, p) => {
    const apply = ({ item, w, h, scale }: typeof p) => {
      node.style.left = `${Math.min(item.x1, item.x2) * w}px`;
      node.style.top = `${Math.min(item.y1, item.y2) * h}px`;
      node.style.width = `${Math.abs(item.x2 - item.x1) * w}px`;
      node.style.height = `${Math.abs(item.y2 - item.y1) * h}px`;
      node.style.fontSize = `${(item.fontSize ?? 12) * scale}px`;
      node.style.color = css(item.color);
    };
    apply(p);
    return { update: apply };
  };

  // Measures against the preview element itself rather than the event's
  // target, which differs between browsers while the pointer is captured.
  function fraction(e: PointerEvent): [number, number] {
    const r = pageEl!.getBoundingClientRect();
    const clampUnit = (n: number) => Math.min(1, Math.max(0, n));
    return [clampUnit((e.clientX - r.left) / r.width), clampUnit((e.clientY - r.top) / r.height)];
  }

  function noteSize(): [number, number] {
    return [NOTE_POINTS / pagePts[0], NOTE_POINTS / pagePts[1]];
  }

  /** The item under a point, topmost first. */
  function hitTest([fx, fy]: [number, number]): Item | null {
    const pad = 0.012;
    for (const item of [...onPage].reverse()) {
      if (item.kind === 'line') {
        const [ax, ay, bx, by] = [item.x1 * viewW, item.y1 * viewH, item.x2 * viewW, item.y2 * viewH];
        const [px, py] = [fx * viewW, fy * viewH];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
        if (Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))) < 8) return item;
        continue;
      }
      const [w, h] = item.kind === 'note' ? noteSize() : [0, 0];
      const left = Math.min(item.x1, item.x2) - pad;
      const right = Math.max(item.x1, item.x2) + w + pad;
      const top = Math.min(item.y1, item.y2) - pad;
      const bottom = Math.max(item.y1, item.y2) + h + pad;
      if (fx >= left && fx <= right && fy >= top && fy <= bottom) return item;
    }
    return null;
  }

  function add(item: Omit<Item, 'id'>) {
    if (items.length >= MAX_ANNOTATIONS) {
      hint = [`ILMPDF adds at most ${MAX_ANNOTATIONS} annotations at a time.`];
      return;
    }
    const id = nextId++;
    items.push({ ...item, id });
    selected = id;
  }

  function down(e: PointerEvent) {
    if (!rendered || !pageEl) return;
    hint = [];
    pageEl.setPointerCapture(e.pointerId);
    pageEl.focus();
    const at = fraction(e);
    if (tool === 'move') {
      const hit = hitTest(at);
      selected = hit?.id ?? null;
      moving = hit ? { id: hit.id, from: at, start: { ...hit } } : null;
      return;
    }
    if (needsWords && !words.trim()) {
      hint = [tool === 'text' ? 'Type the text for the box first.' : 'Type the comment first.'];
      return;
    }
    if (tool === 'note') {
      const [w, h] = noteSize();
      const x = Math.min(at[0], 1 - w);
      const y = Math.min(at[1], 1 - h);
      add({ page: pageIndex, kind: 'note', x1: x, y1: y, x2: x, y2: y, color: [...colors.note], text: words.trim() });
      return;
    }
    draft = { from: at, to: at };
  }

  function drag(e: PointerEvent) {
    if (draft) draft = { from: draft.from, to: fraction(e) };
    if (moving) {
      const item = items.find((i) => i.id === moving!.id);
      if (!item) return;
      const [fx, fy] = fraction(e);
      const s = moving.start;
      const [w, h] = item.kind === 'note' ? noteSize() : [0, 0];
      // Keep the whole item on the page.
      const dx = Math.min(Math.max(fx - moving.from[0], -Math.min(s.x1, s.x2)), 1 - Math.max(s.x1, s.x2) - w);
      const dy = Math.min(Math.max(fy - moving.from[1], -Math.min(s.y1, s.y2)), 1 - Math.max(s.y1, s.y2) - h);
      item.x1 = s.x1 + dx;
      item.x2 = s.x2 + dx;
      item.y1 = s.y1 + dy;
      item.y2 = s.y2 + dy;
    }
  }

  // The final position is set once more where the pointer is let go, in case
  // a browser sends few or no move events.
  function up(e: PointerEvent) {
    drag(e);
    moving = null;
    if (!draft || !kind) return;
    const { from, to } = draft;
    draft = null;
    const wide = Math.abs(to[0] - from[0]) * viewW;
    const tall = Math.abs(to[1] - from[1]) * viewH;
    const big = kind === 'line' ? Math.hypot(wide, tall) >= 6 : wide >= 6 && tall >= 6;
    if (!big) {
      hint = ['Drag a little further to draw it.'];
      return;
    }
    add({
      page: pageIndex,
      kind,
      x1: from[0],
      y1: from[1],
      x2: to[0],
      y2: to[1],
      color: [...colors[kind]],
      ...(kind === 'text' ? { text: words.trim(), fontSize } : {}),
    });
  }

  function remove(id: number) {
    items = items.filter((i) => i.id !== id);
    if (selected === id) selected = null;
  }

  function keys(e: KeyboardEvent) {
    if (!current) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(current.id);
    } else if (e.key === 'Escape') {
      selected = null;
    }
  }

  function pickColor(rgb: Rgb) {
    if (current && tool === 'move') current.color = [...rgb];
    else if (kind) colors[kind] = [...rgb];
  }

  const activeColor = $derived<Rgb>(current && tool === 'move' ? current.color : kind ? colors[kind] : [0, 0, 0]);
  const KIND_NAMES: Record<AnnotKind, string> = { text: 'Text box', highlight: 'Highlight', rect: 'Rectangle', line: 'Line', note: 'Comment' };
  const summary = (i: Item) => (i.text ? `${KIND_NAMES[i.kind]}: ${i.text.length > 40 ? `${i.text.slice(0, 40)}…` : i.text}` : KIND_NAMES[i.kind]);

  function save() {
    const list: NewAnnotation[] = items.map(({ id: _id, ...rest }) => ({ ...rest, color: [...rest.color] as Rgb }));
    job.run(async () => {
      const out = await runMupdfJob({ op: 'annotate', file: copyBytes(initial.bytes), items: list });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(initial.name, '-annotated'));
      return `Saved an annotated copy with ${list.length} ${list.length === 1 ? 'annotation' : 'annotations'}.${note}`;
    });
  }
</script>

<div class="panel">
  <div class="tools" role="toolbar" aria-label="Annotation tools">
    {#each TOOLS as t (t.id)}
      <button
        type="button"
        class:active={tool === t.id}
        aria-pressed={tool === t.id}
        onclick={() => {
          tool = t.id;
          hint = [];
        }}
        data-testid={`tool-btn-${t.id}`}>{t.label}</button
      >
    {/each}
  </div>
  <p class="muted">{TOOLS.find((t) => t.id === tool)!.hint}</p>

  <div class="options">
    {#if kind || current}
      <div class="swatches" role="group" aria-label="Colour">
        {#each COLORS as c (c.name)}
          <button
            type="button"
            class="swatch"
            class:on={same(activeColor, c.rgb)}
            aria-label={c.name}
            aria-pressed={same(activeColor, c.rgb)}
            onclick={() => pickColor(c.rgb)}
            data-testid={`color-${c.name.toLowerCase()}`}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill={css(c.rgb)} /></svg>
          </button>
        {/each}
      </div>
    {/if}
    {#if tool === 'text'}
      <label class="size">
        Size
        <select bind:value={fontSize} data-testid="font-size">
          {#each [10, 12, 14, 18, 24, 32, 48] as s (s)}<option value={s}>{s} pt</option>{/each}
        </select>
      </label>
    {/if}
  </div>
  {#if needsWords}
    <label class="words">
      {tool === 'text' ? 'Text' : 'Comment'}
      <textarea rows="2" maxlength="5000" bind:value={words} data-testid="words"></textarea>
    </label>
  {/if}

  <div class="controls">
    <button type="button" class="quiet" disabled={pageIndex === 0} onclick={() => (pageIndex -= 1)}>‹ Previous</button>
    <span data-testid="page-label">Page {pageIndex + 1} of {initial.pages}</span>
    <button type="button" class="quiet" disabled={pageIndex >= initial.pages - 1} onclick={() => (pageIndex += 1)} data-testid="next-page">Next ›</button>
  </div>
  <Notice messages={previewError} />
  <Notice messages={hint} />
  <!-- A custom drawing surface: pointer to draw or move; Delete removes the selected item (see keys()). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="page"
    class:moving={tool === 'move'}
    role="application"
    aria-label="Page preview. Draw annotations with the pointer; Delete removes the selected one."
    tabindex="0"
    bind:this={pageEl}
    bind:clientWidth={viewW}
    bind:clientHeight={viewH}
    onpointerdown={down}
    onpointermove={drag}
    onpointerup={up}
    onpointercancel={() => {
      draft = null;
      moving = null;
    }}
    onkeydown={keys}
    data-testid="page-preview"
    data-ready={rendered}
  >
    <canvas bind:this={canvas}></canvas>
    <svg class="overlay" viewBox={`0 0 ${viewW} ${viewH}`} aria-hidden="true">
      {#each onPage as item (item.id)}
        {@const l = Math.min(item.x1, item.x2) * viewW}
        {@const t = Math.min(item.y1, item.y2) * viewH}
        {@const w = Math.abs(item.x2 - item.x1) * viewW}
        {@const h = Math.abs(item.y2 - item.y1) * viewH}
        {#if item.kind === 'highlight'}
          <rect class="hl" x={l} y={t} width={w} height={h} fill={css(item.color)} />
        {:else if item.kind === 'rect'}
          <rect x={l} y={t} width={w} height={h} fill="none" stroke={css(item.color)} stroke-width={2 * pxPerPt} />
        {:else if item.kind === 'line'}
          <line x1={item.x1 * viewW} y1={item.y1 * viewH} x2={item.x2 * viewW} y2={item.y2 * viewH} stroke={css(item.color)} stroke-width={2 * pxPerPt} />
        {:else if item.kind === 'note'}
          {@const s = NOTE_POINTS * pxPerPt}
          <rect x={l} y={t} width={s} height={s} rx="2" fill={css(item.color)} stroke="#000" stroke-width="1" />
          <path d={`M${l + s * 0.25} ${t + s * 0.35}h${s * 0.5}M${l + s * 0.25} ${t + s * 0.55}h${s * 0.35}`} stroke="#000" stroke-width="1.5" />
        {/if}
        {#if item.id === selected}
          {@const pad = 3}
          {@const [nw, nh] = item.kind === 'note' ? [NOTE_POINTS * pxPerPt, NOTE_POINTS * pxPerPt] : [w, h]}
          <rect class="sel" x={l - pad} y={t - pad} width={nw + 2 * pad} height={nh + 2 * pad} fill="none" />
        {/if}
      {/each}
      {#if draft && kind}
        {@const [a, b] = [draft.from, draft.to]}
        {#if kind === 'line'}
          <line x1={a[0] * viewW} y1={a[1] * viewH} x2={b[0] * viewW} y2={b[1] * viewH} stroke={css(colors.line)} stroke-width={2 * pxPerPt} />
        {:else}
          <rect
            class="draft"
            x={Math.min(a[0], b[0]) * viewW}
            y={Math.min(a[1], b[1]) * viewH}
            width={Math.abs(b[0] - a[0]) * viewW}
            height={Math.abs(b[1] - a[1]) * viewH}
            fill="none"
          />
        {/if}
      {/if}
    </svg>
    {#each onPage.filter((i) => i.kind === 'text') as item (item.id)}
      <div class="textbox" use:place={{ item, w: viewW, h: viewH, scale: pxPerPt }}>{item.text}</div>
    {/each}
  </div>

  {#if current && (current.kind === 'text' || current.kind === 'note')}
    <label class="words">
      Edit the selected {current.kind === 'text' ? 'text box' : 'comment'}
      <textarea rows="2" maxlength="5000" bind:value={current.text} data-testid="edit-words"></textarea>
    </label>
  {/if}

  <h3>On this page ({onPage.length})</h3>
  {#if onPage.length === 0}
    <p class="muted">Nothing added to this page yet.</p>
  {:else}
    <ul class="list" data-testid="item-list">
      {#each onPage as item (item.id)}
        <li class:sel={item.id === selected}>
          <button type="button" class="quiet name" onclick={() => (selected = item.id)}>{summary(item)}</button>
          <button type="button" class="quiet" onclick={() => remove(item.id)} aria-label={`Delete ${summary(item)}`}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="muted">
    {items.length} {items.length === 1 ? 'annotation' : 'annotations'} in total. They are saved as real PDF annotations, so
    Preview and Acrobat can still edit or remove them.
  </p>
  <RemoveScriptsOption bind:checked={alsoClean} />
  <div class="actions">
    <button type="button" disabled={job.busy || items.length === 0} onclick={save} data-testid="run">
      {job.busy ? 'Saving…' : 'Save annotated PDF'}
    </button>
  </div>
</div>
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />

<style>
  h3 {
    margin: 14px 0 6px;
    font-size: 15px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .tools button {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
  }
  .tools button.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    margin-bottom: 8px;
  }
  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatch {
    width: 26px;
    height: 26px;
    padding: 3px;
    border-radius: 50%;
    background: transparent;
    border: 2px solid transparent;
  }
  .swatch.on {
    border-color: var(--accent);
  }
  .swatch svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .size {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .words {
    display: grid;
    gap: 4px;
    margin-bottom: 10px;
  }
  .words textarea {
    font: inherit;
    width: 100%;
    resize: vertical;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
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
  .page.moving {
    cursor: move;
  }
  .page:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
  .page canvas {
    display: block;
    max-width: 100%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  }
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .hl {
    fill-opacity: 0.45;
    mix-blend-mode: multiply;
  }
  .sel,
  .draft {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .textbox {
    position: absolute;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.15;
    font-family: Helvetica, Arial, sans-serif;
    pointer-events: none;
  }
  .list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 4px;
  }
  .list li.sel {
    border-color: var(--accent);
  }
  .list .name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
