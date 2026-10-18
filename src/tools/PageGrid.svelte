<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import Thumb from '../lib/Thumb.svelte';
  import Notice from '../lib/Notice.svelte';
  import { move, type PdfFile } from '../core/files';
  import { closePdf, openPdf } from '../engines/pdfjs';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import type { PagePlan } from '../engines/pdflib-ops';

  type Props = { file: PdfFile };
  let { file }: Props = $props();

  type Card = { key: string; index: number; rotate: PagePlan['rotate']; selected: boolean };
  // The parent re-creates this component for each new file, so reading the
  // initial file once is intended.
  const initial = untrack(() => file);
  let cards = $state<Card[]>(
    Array.from({ length: initial.pages }, (_, i) => ({ key: `p${i}`, index: i, rotate: 0, selected: false })),
  );
  let doc = $state<PDFDocumentProxy | null>(null);
  let previewError = $state<string[]>([]);
  let dragFrom = $state<number | null>(null);
  const job = new ToolRun();
  let alsoClean = $state(false);

  let closed = false;
  openPdf(initial.bytes)
    .then((d) => {
      if (closed) void closePdf(d);
      else doc = d;
    })
    .catch((e: Error) => (previewError = [`Previews unavailable: ${e.message}`]));
  onDestroy(() => {
    closed = true;
    void closePdf(doc);
  });

  const selectedCount = $derived(cards.filter((c) => c.selected).length);

  function turn(i: number, by: 90 | -90) {
    cards = cards.map((c, j) => (j === i ? { ...c, rotate: (((c.rotate + by) % 360) + 360) % 360 as PagePlan['rotate'] } : c));
  }
  function turnAll(by: 90 | -90) {
    cards = cards.map((c) => ({ ...c, rotate: (((c.rotate + by) % 360) + 360) % 360 as PagePlan['rotate'] }));
  }
  const plan = (list: Card[]): PagePlan[] => list.map((c) => ({ index: c.index, rotate: c.rotate }));

  function saveAll() {
    job.run(async () => {
      const out = await runPdfJob({ op: 'organize', file: copyBytes(file.bytes), plan: plan(cards) });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-organized'));
      return `Saved ${cards.length} pages.${note}`;
    });
  }
  function extractSelected() {
    job.run(async () => {
      const chosen = cards.filter((c) => c.selected);
      const out = await runPdfJob({ op: 'organize', file: copyBytes(file.bytes), plan: plan(chosen) });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-extract'));
      return `Extracted ${chosen.length} page${chosen.length === 1 ? '' : 's'}.${note}`;
    });
  }
</script>

<div class="actions">
  <button class="quiet" onclick={() => turnAll(-90)}>Rotate all left</button>
  <button class="quiet" onclick={() => turnAll(90)}>Rotate all right</button>
  <button class="quiet" onclick={() => (cards = cards.map((c) => ({ ...c, selected: selectedCount < cards.length })))}>
    {selectedCount < cards.length ? 'Select all' : 'Select none'}
  </button>
  <span class="muted">{cards.length} of {file.pages} pages kept · drag cards or use the arrows to reorder</span>
</div>
<Notice messages={previewError} />

<ul class="grid" data-testid="page-grid">
  {#each cards as card, i (card.key)}
    <li
      class="card"
      class:selected={card.selected}
      class:dragging={dragFrom === i}
      draggable="true"
      data-testid="page-card"
      data-index={card.index}
      data-rotate={card.rotate}
      ondragstart={() => (dragFrom = i)}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => {
        e.preventDefault();
        if (dragFrom !== null) cards = move(cards, dragFrom, i);
        dragFrom = null;
      }}
      ondragend={() => (dragFrom = null)}
    >
      {#if doc}
        <Thumb {doc} pageNumber={card.index + 1} rotation={card.rotate} />
      {:else}
        <div class="placeholder"></div>
      {/if}
      <label class="check"><input type="checkbox" bind:checked={card.selected} data-testid="select" /> Page {card.index + 1}</label>
      <div class="tools">
        <button class="quiet icon" aria-label="Move left" disabled={i === 0} onclick={() => (cards = move(cards, i, i - 1))} data-testid="left">←</button>
        <button class="quiet icon" aria-label="Rotate left" onclick={() => turn(i, -90)}>⟲</button>
        <button class="quiet icon" aria-label="Rotate right" onclick={() => turn(i, 90)} data-testid="rotate">⟳</button>
        <button class="quiet icon" aria-label="Delete page" disabled={cards.length === 1} onclick={() => (cards = cards.filter((c) => c.key !== card.key))} data-testid="delete">✕</button>
        <button class="quiet icon" aria-label="Move right" disabled={i === cards.length - 1} onclick={() => (cards = move(cards, i, i + 1))}>→</button>
      </div>
    </li>
  {/each}
</ul>

<RemoveScriptsOption bind:checked={alsoClean} />
<div class="actions">
  <button disabled={job.busy} onclick={saveAll} data-testid="run">{job.busy ? 'Working…' : 'Save organized PDF'}</button>
  <button class="quiet" disabled={job.busy || selectedCount === 0} onclick={extractSelected} data-testid="extract">
    Extract {selectedCount} selected page{selectedCount === 1 ? '' : 's'}
  </button>
</div>
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
    gap: 12px;
  }
  .card {
    display: grid;
    gap: 8px;
    padding: 10px;
    background: var(--surface);
    border: 2px solid var(--border);
    border-radius: 10px;
    cursor: grab;
  }
  .card.selected {
    border-color: var(--accent);
  }
  .card.dragging {
    opacity: 0.4;
  }
  .placeholder {
    height: 160px;
    background: var(--bg);
    border-radius: 6px;
  }
  .tools {
    display: flex;
    justify-content: space-between;
    gap: 2px;
  }
  .tools button {
    padding: 2px 6px;
  }
</style>
