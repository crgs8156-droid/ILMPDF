<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import { loadPdfs, move, type PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { formatBytes } from '../core/validate';
  import { MAX_FILES } from '../core/limits';
  import { ToolRun } from '../core/run.svelte';

  let files = $state<PdfFile[]>([]);
  let rejected = $state<string[]>([]);
  const job = new ToolRun();

  // Adds run one after another so files keep the order they were added in.
  let queue = Promise.resolve();
  function add(list: File[]) {
    queue = queue.then(async () => {
      const { ok, rejected: bad } = await loadPdfs(list, MAX_FILES - files.length);
      files = [...files, ...ok];
      rejected = bad.map((r) => `${r.name}: ${r.reason}`);
    });
  }

  function merge() {
    job.run(async () => {
      const out = await runPdfJob({ op: 'merge', files: files.map((f) => copyBytes(f.bytes)) });
      saveBytes(out.files![0]!, 'merged.pdf');
      return `Merged ${files.length} files. Saved merged.pdf.`;
    });
  }
</script>

<FilePicker onFiles={add} compact={files.length > 0} title={files.length ? 'Add more PDFs' : 'Drop PDFs to merge'} />
<Notice messages={rejected} />

{#if files.length > 0}
  <ol class="list" data-testid="merge-list">
    {#each files as f, i (f.key)}
      <li data-testid="merge-row">
        <div class="meta">
          <div class="name">{i + 1}. {f.name}</div>
          <div class="detail">{f.pages} pages · {formatBytes(f.size)}</div>
        </div>
        <div class="actions">
          <button class="quiet icon" aria-label="Move up" disabled={i === 0} onclick={() => (files = move(files, i, i - 1))}>↑</button>
          <button class="quiet icon" aria-label="Move down" disabled={i === files.length - 1} onclick={() => (files = move(files, i, i + 1))}>↓</button>
          <button class="quiet icon" aria-label="Remove" onclick={() => (files = files.filter((x) => x.key !== f.key))}>✕</button>
        </div>
      </li>
    {/each}
  </ol>
  <div class="actions">
    <button disabled={files.length < 2 || job.busy} onclick={merge} data-testid="run">
      {job.busy ? 'Merging…' : `Merge ${files.length} PDFs`}
    </button>
    {#if files.length < 2}<span class="muted">Add at least two PDFs.</span>{/if}
  </div>
{/if}
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />
