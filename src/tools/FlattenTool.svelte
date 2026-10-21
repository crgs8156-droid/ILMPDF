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
  let fields = $state(true);
  let annotations = $state(true);
  let alsoClean = $state(false);

  // Like Repair, this only checks the basics here and lets MuPDF (in its
  // worker) read the file.
  async function pick(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    errors = [];
    file = null;
    job.errors = [];
    job.done = [];
    const meta = checkFileMeta(picked.name, picked.size);
    if (!meta.ok) return void (errors = [`${picked.name}: ${meta.reason}`]);
    const bytes = new Uint8Array(await picked.arrayBuffer());
    if (!hasPdfHeader(bytes.subarray(0, 1024))) return void (errors = [`${picked.name}: Not a real PDF (header missing)`]);
    file = { name: picked.name, size: picked.size, bytes };
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  function run(f: Picked) {
    job.run(async () => {
      const out = await runMupdfJob({ op: 'flatten', file: copyBytes(f.bytes), opts: { fields, annotations } });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(f.name, '-flattened'));
      const counts = {
        fields: Number(out.meta?.['fields'] ?? 0),
        annotations: Number(out.meta?.['annotations'] ?? 0),
        signatures: Number(out.meta?.['signatures'] ?? 0),
      };
      const parts = [];
      if (fields) parts.push(plural(counts.fields, 'form field', 'form fields'));
      if (annotations) parts.push(plural(counts.annotations, 'annotation', 'annotations'));
      const warning = counts.signatures
        ? ` Note: ${plural(counts.signatures, 'digital signature was', 'digital signatures were')} in this file. It still shows on the page but can no longer be verified.`
        : '';
      return `Flattened ${parts.join(' and ')} and saved a copy; the original file is unchanged.${warning}${note}`;
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
      Draws the chosen items into the pages. They look the same, but can no longer be edited, moved or removed, and the
      form can no longer be filled in. Links keep working. Digital signatures stop being verifiable. Password-protected
      PDFs need to be unlocked first.
    </p>
    <label class="check">
      <input type="checkbox" bind:checked={fields} data-testid="flatten-fields" />
      Form fields (text boxes, checkboxes, dropdowns, signature fields)
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={annotations} data-testid="flatten-annotations" />
      Comments and markups (notes, highlights, text boxes, drawings, stamps)
    </label>
    <RemoveScriptsOption bind:checked={alsoClean} />
    <div class="actions">
      <button type="button" disabled={job.busy || (!fields && !annotations)} onclick={() => file && run(file)} data-testid="run">
        {job.busy ? 'Flattening…' : 'Flatten PDF'}
      </button>
    </div>
  </div>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{:else}
  <FilePicker multiple={false} title="Drop a PDF here" onFiles={pick} />
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
