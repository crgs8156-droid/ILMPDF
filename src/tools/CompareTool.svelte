<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import PdfHeader from '../lib/PdfHeader.svelte';
  import Notice from '../lib/Notice.svelte';
  import CompareVisual from './CompareVisual.svelte';
  import { loadPdfs, type PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { ToolRun } from '../core/run.svelte';
  import { changeViews, formatReport, summarize, type TextDiff } from '../core/word-diff';

  // At most this many changes are drawn on screen; the saved report has all.
  const SHOWN_CHANGES = 500;

  let older = $state<PdfFile | null>(null);
  let newer = $state<PdfFile | null>(null);
  let loading = $state(false);
  let errors = $state<string[]>([]);
  let view = $state<'text' | 'visual'>('text');
  // The last comparison, kept only in memory.
  let diff = $state<(TextDiff & { pagesA: number; pagesB: number }) | null>(null);
  const views = $derived(diff ? changeViews(diff) : []);
  const job = new ToolRun();

  async function pick(files: File[], which: 'older' | 'newer') {
    loading = true;
    errors = [];
    const { ok, rejected } = await loadPdfs(files.slice(0, 1));
    if (ok[0]) {
      if (which === 'older') older = ok[0];
      else newer = ok[0];
      diff = null;
    }
    errors = rejected.map((r) => `${r.name}: ${r.reason}`);
    loading = false;
  }

  function clear(which: 'older' | 'newer') {
    if (which === 'older') older = null;
    else newer = null;
    diff = null;
  }

  function swap() {
    [older, newer] = [newer, older];
    diff = null;
  }

  function compare(a: PdfFile, b: PdfFile) {
    diff = null;
    job.run(async () => {
      const out = await runMupdfJob({ op: 'compareText', files: [copyBytes(a.bytes), copyBytes(b.bytes)] });
      diff = out.diff!;
      if (diff.wordsA === 0 && diff.wordsB === 0) {
        return 'Neither file has any text, so they are probably scanned. Use the Visual tab to compare the pages.';
      }
      return summarize(diff);
    });
  }

  // Local date, so the report is named after the day on this Mac.
  function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function saveReport(a: PdfFile, b: PdfFile) {
    if (!diff) return;
    const text = formatReport(diff, a.name, b.name);
    saveBytes(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${today()}-compare-report.txt`);
  }
</script>

<div class="slots">
  <div class="slot" data-testid="slot-older">
    <p class="label">Older version</p>
    {#if older}
      <PdfHeader file={older} onClear={() => clear('older')} />
    {:else}
      <FilePicker multiple={false} compact title="Drop the older PDF here" onFiles={(f) => pick(f, 'older')} />
    {/if}
  </div>
  <div class="slot" data-testid="slot-newer">
    <p class="label">Newer version</p>
    {#if newer}
      <PdfHeader file={newer} onClear={() => clear('newer')} />
    {:else if older}
      <FilePicker multiple={false} compact title="Drop the newer PDF here" onFiles={(f) => pick(f, 'newer')} />
    {:else}
      <p class="muted">Choose the older file first.</p>
    {/if}
  </div>
</div>
{#if loading}<p class="muted">Reading…</p>{/if}
<Notice messages={errors} />

{#if older && newer}
  {@const a = older}
  {@const b = newer}
  <div class="panel">
    <p class="muted">
      Text: compares the words of both files, so moved line breaks don't count as changes. Visual: draws each page of
      both files and shows in red what looks different, including pictures and layout.
    </p>
    <div class="actions">
      <button type="button" disabled={job.busy} onclick={() => compare(a, b)} data-testid="run">
        {job.busy ? 'Comparing…' : 'Compare'}
      </button>
      <button type="button" class="quiet" disabled={job.busy} onclick={swap} data-testid="swap">Swap older and newer</button>
    </div>
  </div>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />

  {#if diff}
    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class:quiet={view !== 'text'}
        aria-selected={view === 'text'}
        onclick={() => (view = 'text')}
        data-testid="tab-text">Text changes</button
      >
      <button
        type="button"
        role="tab"
        class:quiet={view !== 'visual'}
        aria-selected={view === 'visual'}
        onclick={() => (view = 'visual')}
        data-testid="tab-visual">Visual</button
      >
    </div>

    {#if view === 'text'}
      <div class="panel" data-testid="text-changes">
        {#if diff.wordsA === 0 || diff.wordsB === 0}
          <Notice
            kind="info"
            messages={['One of the files has no text (it may be scanned), so every word shows as a change. The Visual tab still works.']}
          />
        {/if}
        {#if diff.tooDifferent}
          <p>These files differ in too many places to list word by word. Try the Visual tab instead.</p>
        {:else if views.length === 0}
          <p data-testid="no-changes">No text changes. The pages may still look different: check the Visual tab.</p>
        {:else}
          <ol class="changes">
            {#each views.slice(0, SHOWN_CHANGES) as v, n (n)}
              <li data-testid="change">
                <span class="where">Older page {v.change.pageA} · newer page {v.change.pageB}</span>
                <span class="words">
                  {#if v.before.length}<span class="ctx">…{v.before.join(' ')}</span>{/if}
                  {#each v.parts as part, p (p)}
                    {' '}<span class={part.kind} data-testid="word-{part.kind}">{part.words.join(' ')}</span>
                  {/each}
                  {#if v.after.length}{' '}<span class="ctx">{v.after.join(' ')}…</span>{/if}
                </span>
              </li>
            {/each}
          </ol>
          {#if views.length > SHOWN_CHANGES}
            <p class="muted">Showing the first {SHOWN_CHANGES} of {views.length} changes. The saved report lists all of them.</p>
          {/if}
        {/if}
        <div class="actions">
          <button type="button" class="quiet" onclick={() => saveReport(a, b)} data-testid="save-report">Save report (.txt)</button>
          <span class="muted">Red with a line through: removed. Green: added.</span>
        </div>
      </div>
    {:else}
      <CompareVisual older={a} newer={b} />
    {/if}
  {/if}
{/if}

<style>
  .slots {
    display: grid;
    gap: 12px;
  }
  .slot {
    display: grid;
    gap: 6px;
  }
  .label {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .tabs {
    display: flex;
    gap: 8px;
  }
  .changes {
    margin: 0;
    padding-left: 22px;
    display: grid;
    gap: 10px;
  }
  .changes li {
    display: grid;
    gap: 2px;
  }
  .where {
    font-size: 12px;
    color: var(--muted);
  }
  .words {
    overflow-wrap: anywhere;
  }
  .ctx {
    color: var(--muted);
  }
  .removed {
    color: var(--bad);
    text-decoration: line-through;
  }
  .added {
    color: var(--good);
    font-weight: 600;
  }
</style>
