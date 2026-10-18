<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { checkFileMeta, formatBytes, hasPdfHeader, safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';

  type Picked = { name: string; size: number; bytes: Uint8Array };

  let file = $state<Picked | null>(null);
  let errors = $state<string[]>([]);
  const job = new ToolRun();
  let alsoClean = $state(false);

  // The shared loader opens files with pdf-lib, which refuses many damaged
  // PDFs. This tool only checks the basics here and lets MuPDF (in its
  // worker) do the reading and repairing.
  async function pick(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    errors = [];
    file = null;
    const meta = checkFileMeta(picked.name, picked.size);
    if (!meta.ok) return void (errors = [`${picked.name}: ${meta.reason}`]);
    const bytes = new Uint8Array(await picked.arrayBuffer());
    if (!hasPdfHeader(bytes.subarray(0, 1024))) return void (errors = [`${picked.name}: Not a real PDF (header missing)`]);
    file = { name: picked.name, size: picked.size, bytes };
  }

  function repair(f: Picked) {
    job.run(async () => {
      const out = await runMupdfJob({ op: 'repair', file: copyBytes(f.bytes) });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(f.name, '-repaired'));
      const pages = `${out.count} page${out.count === 1 ? '' : 's'}`;
      return out.repaired
        ? `Repaired and saved a fixed copy with ${pages}. Check that nothing is missing: badly damaged parts can't always be recovered.${note}`
        : `No damage found. Saved a cleanly rewritten copy with ${pages}, which can still help apps that struggle with the original.${note}`;
    });
  }

  function clear() {
    file = null;
    job.errors = [];
    job.done = [];
  }
</script>

{#if file}
  <div class="head" data-testid="loaded-file">
    <div class="meta">
      <span class="name">{file.name}</span>
      <span class="detail">{formatBytes(file.size)}</span>
    </div>
    <button type="button" class="quiet" onclick={clear}>Choose another file</button>
  </div>
  <div class="panel">
    <p class="muted">
      Rebuilds the file's internal index and rewrites it cleanly. The original file is unchanged. Password-protected PDFs
      need to be unlocked first.
    </p>
    <RemoveScriptsOption bind:checked={alsoClean} />
    <div class="actions">
      <button type="button" disabled={job.busy} onclick={() => file && repair(file)} data-testid="run">
        {job.busy ? 'Repairing…' : 'Repair PDF'}
      </button>
    </div>
  </div>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{:else}
  <FilePicker multiple={false} title="Drop a damaged PDF here" onFiles={pick} />
{/if}
<Notice messages={errors} />

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .meta {
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    color: var(--muted);
    font-size: 13px;
  }
</style>
