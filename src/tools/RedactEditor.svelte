<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
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
  import type { RedactBox } from '../engines/mupdf-ops';

  type Props = { file: PdfFile };
  let { file }: Props = $props();
  // The parent re-creates this component for each new file.
  const initial = untrack(() => file);

  // Every marked area on every page, as fractions of the page as shown.
  // `id` only tells boxes apart in the list, and `term` is the search that
  // found the box, if any; neither is sent to the worker as part of a box.
  type Marked = RedactBox & { id: number; term?: string };
  let boxes = $state<Marked[]>([]);
  let nextId = 0;
  const onPage = $derived(boxes.filter((b) => b.page === pageIndex));
  const markedPages = $derived([...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b));

  let doc = $state<PDFDocumentProxy | null>(null);
  let previewError = $state<string[]>([]);
  let pageIndex = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let pageEl = $state<HTMLDivElement>();
  let rendered = $state(false);
  // The box being drawn right now, if any.
  let draft = $state<RedactBox | null>(null);
  let dragFrom: [number, number] | null = null;

  let search = $state('');
  let stripMetadata = $state(true);
  let removeAllAttachments = $state(false);
  // Attached files the last redaction kept because it couldn't read them.
  let unchecked = $state<string[]>([]);
  const finder = new ToolRun();
  const job = new ToolRun();
  let alsoClean = $state(false);

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

  // Positions a box through the style object (CSSOM): the production CSP
  // blocks inline style attributes, but not this.
  function place(el: HTMLElement, box: RedactBox) {
    const apply = (b: RedactBox) => {
      el.style.left = `${b.x * 100}%`;
      el.style.top = `${b.y * 100}%`;
      el.style.width = `${b.width * 100}%`;
      el.style.height = `${b.height * 100}%`;
    };
    apply(box);
    return { update: apply };
  }

  // Measures against the preview element itself rather than the event's
  // target, which differs between browsers while the pointer is captured.
  function fraction(e: PointerEvent): [number, number] {
    const r = pageEl!.getBoundingClientRect();
    const clampUnit = (n: number) => Math.min(1, Math.max(0, n));
    return [clampUnit((e.clientX - r.left) / r.width), clampUnit((e.clientY - r.top) / r.height)];
  }

  function drag(e: PointerEvent) {
    if (!dragFrom || !pageEl) return;
    const [fx, fy] = fraction(e);
    const [sx, sy] = dragFrom;
    draft = { page: pageIndex, x: Math.min(sx, fx), y: Math.min(sy, fy), width: Math.abs(fx - sx), height: Math.abs(fy - sy) };
  }

  // The box is added where the pointer is let go (some browsers send few or
  // no move events), unless it is too small to be meant.
  function finish(e: PointerEvent) {
    drag(e);
    if (draft && draft.width > 0.005 && draft.height > 0.005) boxes = [...boxes, { ...draft, id: nextId++ }];
    draft = null;
    dragFrom = null;
  }

  const remove = (id: number) => (boxes = boxes.filter((b) => b.id !== id));
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  function find() {
    const text = search;
    finder.run(async () => {
      const out = await runMupdfJob({ op: 'findText', file: copyBytes(initial.bytes), text });
      const found = out.boxes ?? [];
      if (found.length === 0) return `"${text.trim()}" was not found. Scanned pages (pictures of text) can't be searched.`;
      const term = text.trim();
      boxes = [...boxes, ...found.map((b) => ({ ...b, id: nextId++, term }))];
      const pages = new Set(found.map((b) => b.page)).size;
      const fields = out.count ?? 0;
      pageIndex = found[0]!.page;
      const inFields = fields > 0 ? ` (${fields} in form ${fields === 1 ? 'field' : 'fields'})` : '';
      return `Marked ${plural(found.length, 'match', 'matches')}${inFields} on ${plural(pages, 'page')}. Check each one before redacting.`;
    });
  }

  function apply() {
    const chosen = boxes.map(({ page, x, y, width, height }) => ({ page, x, y, width, height }));
    // Only searches that still have a marked match count as redacted text.
    const phrases = [...new Set(boxes.flatMap((b) => (b.term ? [b.term] : [])))];
    const options = { stripMetadata, removeAllAttachments, phrases };
    const clean = alsoClean;
    unchecked = [];
    job.run(async () => {
      const out = await runMupdfJob({ op: 'redact', file: copyBytes(initial.bytes), boxes: chosen, options });
      const { files: [saved], note } = await cleanIf(clean, out.files!);
      saveBytes(saved!, safeFileName(initial.name, '-redacted'));
      const count = (key: string) => Number(out.meta?.[key] ?? 0);
      const extras = [
        count('bookmarks') > 0 ? plural(count('bookmarks'), 'bookmark') : '',
        count('attachments') > 0 ? plural(count('attachments'), 'attached file') : '',
        count('comments') > 0 ? plural(count('comments'), 'comment') : '',
      ].filter(Boolean);
      const list = extras.length > 1 ? `${extras.slice(0, -1).join(', ')} and ${extras.at(-1)}` : extras[0];
      const alsoRemoved = extras.length > 0 ? ` Also removed ${list} that mentioned the redacted text.` : '';
      // Removing scripts also removes every attached file, so none is left to warn about.
      if (!clean) unchecked = (out.unchecked ?? []).map((name) => `Kept "${name}": this attached file can't be checked for the redacted text.`);
      return `Redacted ${plural(out.count ?? 0, 'area')} on ${plural(count('pages'), 'page')} and saved a new copy.${alsoRemoved}${note} Open it and check it before you share it.`;
    });
  }
</script>

<div class="panel">
  <p class="muted">
    Drag across the page to mark an area, or find a word or phrase below to mark every place it appears. Click a marked
    area to unmark it. Everything under the marks is deleted from the file, not just covered.
  </p>
  <form
    class="find"
    onsubmit={(e) => {
      e.preventDefault();
      find();
    }}
  >
    <input type="search" bind:value={search} maxlength="200" placeholder="Find text, e.g. a name or account number" aria-label="Text to find" data-testid="find-text" />
    <button type="submit" class="quiet" disabled={finder.busy || !search.trim()} data-testid="find">{finder.busy ? 'Finding…' : 'Mark all'}</button>
  </form>
  <Notice messages={finder.errors} />
  <Notice kind="ok" messages={finder.done} />
  <div class="controls">
    <button type="button" class="quiet" disabled={pageIndex === 0} onclick={() => (pageIndex -= 1)}>‹ Previous</button>
    <span data-testid="page-label">Page {pageIndex + 1} of {initial.pages}</span>
    <button type="button" class="quiet" disabled={pageIndex >= initial.pages - 1} onclick={() => (pageIndex += 1)} data-testid="next-page">Next ›</button>
    <button type="button" class="quiet clear" disabled={onPage.length === 0} onclick={() => (boxes = boxes.filter((b) => b.page !== pageIndex))}>
      Unmark this page
    </button>
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
    onpointerup={finish}
    onpointercancel={() => {
      draft = null;
      dragFrom = null;
    }}
    data-testid="page-preview"
    data-ready={rendered}
  >
    <canvas bind:this={canvas}></canvas>
    {#each onPage as box (box.id)}
      <button
        type="button"
        class="mark"
        use:place={box}
        aria-label="Unmark this area"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => remove(box.id)}
        data-testid="mark"
      ></button>
    {/each}
    {#if draft}
      <div class="mark draft" use:place={draft}></div>
    {/if}
  </div>
  <p class="muted summary" data-testid="mark-summary">
    {#if boxes.length === 0}
      Nothing marked yet.
    {:else}
      {plural(boxes.length, 'area')} marked on {plural(markedPages.length, 'page')}:
      {#each markedPages as p (p)}
        <button type="button" class="link" onclick={() => (pageIndex = p)}>{p + 1}</button>
      {/each}
    {/if}
  </p>
  <label class="check">
    <input type="checkbox" bind:checked={stripMetadata} data-testid="strip-metadata" />
    Also remove hidden details (title, author, and tagging that can hold copies of the text)
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={removeAllAttachments} data-testid="remove-all-attachments" />
    Also remove every attached file, not just the ones that mention the redacted text
  </label>
  <p class="muted">
    Links, comments and form fields that touch a marked area are removed too. "Mark all" also searches filled-in form
    fields. Bookmarks and attached files that mention the redacted text (your searches and the words under your marks)
    are removed. Attached files that can't be read as text, such as Word files or pictures, are kept and named after
    redacting.
  </p>
  <RemoveScriptsOption bind:checked={alsoClean} />
  <div class="actions">
    <button type="button" disabled={job.busy || boxes.length === 0} onclick={apply} data-testid="run">
      {job.busy ? 'Redacting…' : 'Redact and save'}
    </button>
    {#if boxes.length > 0}
      <button type="button" class="quiet" onclick={() => (boxes = [])}>Unmark all</button>
    {/if}
  </div>
</div>
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />
<Notice kind="info" messages={unchecked} />

<style>
  .find {
    display: flex;
    gap: 8px;
    margin: 10px 0;
  }
  .find input {
    flex: 1;
    min-width: 0;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .clear {
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
  .mark {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    min-width: 0;
    border: 1px solid #e5484d;
    border-radius: 0;
    background: rgb(0 0 0 / 0.7);
    cursor: pointer;
  }
  .mark:hover,
  .mark:focus-visible {
    background: rgb(229 72 77 / 0.55);
  }
  .draft {
    pointer-events: none;
    border-style: dashed;
    background: rgb(0 0 0 / 0.4);
  }
  .summary {
    text-align: center;
  }
  .link {
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
