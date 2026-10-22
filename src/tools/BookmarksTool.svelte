<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import BookmarksEditor, { type Row } from './BookmarksEditor.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import { MAX_SPLIT_PARTS, partFileName, planSplit } from '../core/bookmarks';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';

  // The bookmarks as read from the file and as edited, kept only in memory.
  let rows = $state<Row[]>([]);
  let file = $state<PdfFile | null>(null);
  let splitLevel = $state(0);
  let alsoClean = $state(false);
  const save = new ToolRun();
  const split = new ToolRun();
  let nextKey = 0;
  const newKey = () => nextKey++;

  const deepest = $derived(rows.reduce((m, r) => Math.max(m, r.level), 0));
  const parts = $derived(file ? planSplit(rows, file.pages, splitLevel) : []);

  // Runs once per chosen file (the file picker re-creates this part of the
  // page for each new file), so edits never carry over to another file.
  // State changes only after the await: Svelte forbids changing state
  // while it is drawing the page.
  async function load(f: PdfFile) {
    const out = await runMupdfJob({ op: 'readBookmarks', file: copyBytes(f.bytes) });
    file = f;
    splitLevel = 0;
    rows = (out.bookmarks ?? []).map((b) => ({ ...b, key: newKey() }));
  }

  // Only the bookmark fields go to the worker (not the editor's row keys).
  const plain = () => rows.map(({ title, page, level, open, target }) => ({ title, page, level, open, ...(target ? { target } : {}) }));

  function saveEdited(f: PdfFile) {
    save.run(async () => {
      const out = await runMupdfJob({ op: 'writeBookmarks', file: copyBytes(f.bytes), bookmarks: plain() });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(f.name, '-bookmarks'));
      const n = rows.length;
      return n === 0 ? `Saved a copy with all bookmarks removed.${note}` : `Saved a copy with ${n} bookmark${n === 1 ? '' : 's'}.${note}`;
    });
  }

  function splitByBookmarks(f: PdfFile) {
    split.run(async () => {
      const plan = parts;
      if (plan.length === 0) throw new Error('No bookmark at this level points to a page, so there is nothing to split at.');
      if (plan.length > MAX_SPLIT_PARTS) throw new Error(`That would make ${plan.length} files. ILMPDF makes at most ${MAX_SPLIT_PARTS} at a time.`);
      const out = await runPdfJob({ op: 'pick', file: copyBytes(f.bytes), groups: plan.map((p) => p.pages) });
      const { files, note } = await cleanIf(alsoClean, out.files!);
      files.forEach((bytes, i) => saveBytes(bytes, partFileName(f.name, i + 1, files.length, plan[i]!.title)));
      return `Created ${files.length} PDF${files.length === 1 ? '' : 's'}.${note}`;
    });
  }
</script>

<SinglePdf>
  {#snippet children(f: PdfFile)}
    {#await load(f)}
      <p class="muted">Reading bookmarks…</p>
    {:then}
        <div class="panel">
          <h3>Bookmarks</h3>
          <p class="muted">
            Rename, re-point, reorder and nest bookmarks. ← and → change nesting; a bookmark's sub-bookmarks move with it.
            Leave the page empty for a heading that goes nowhere.
          </p>
          <BookmarksEditor bind:rows pages={f.pages} {newKey} />
          <RemoveScriptsOption bind:checked={alsoClean} />
          <div class="actions">
            <button type="button" disabled={save.busy} onclick={() => saveEdited(f)} data-testid="run">
              {save.busy ? 'Saving…' : 'Save PDF with these bookmarks'}
            </button>
          </div>
        </div>
        <Notice messages={save.errors} />
        <Notice kind="ok" messages={save.done} />

        <div class="panel">
          <h3>Split by bookmarks</h3>
          <div class="fields">
            <label class="field">Start a new file at
              <select bind:value={splitLevel} data-testid="bm-split-level">
                {#each { length: Math.min(deepest, 4) + 1 } as _, level}
                  <option value={level}>{level === 0 ? 'Top-level bookmarks' : `Bookmarks down to level ${level + 1}`}</option>
                {/each}
              </select>
            </label>
          </div>
          <p class="muted" data-testid="bm-split-summary">
            {#if parts.length === 0}
              No bookmark at this level points to a page.
            {:else}
              Makes {parts.length} file{parts.length === 1 ? '' : 's'}, named after the bookmarks. Uses the bookmarks as edited above.
            {/if}
          </p>
          <div class="actions">
            <button type="button" disabled={split.busy || parts.length === 0} onclick={() => splitByBookmarks(f)} data-testid="bm-split">
              {split.busy ? 'Splitting…' : 'Split PDF'}
            </button>
          </div>
        </div>
        <Notice messages={split.errors} />
        <Notice kind="ok" messages={split.done} />
    {:catch err}
      <Notice messages={[err.message]} />
    {/await}
  {/snippet}
</SinglePdf>

<style>
  h3 {
    margin: 0;
    font-size: 16px;
  }
</style>
