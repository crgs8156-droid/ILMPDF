<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import { loadPdfs, type PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';

  type Props = { file: PdfFile };
  let { file }: Props = $props();

  let what = $state<'blank' | 'pdf'>('blank');
  let count = $state(1);
  let where = $state<'start' | 'before' | 'after' | 'end'>('end');
  let pageNo = $state(1);
  let other = $state<PdfFile | null>(null);
  let pickErrors = $state<string[]>([]);
  let alsoClean = $state(false);
  const job = new ToolRun();

  async function pickOther(files: File[]) {
    pickErrors = [];
    const { ok, rejected } = await loadPdfs(files.slice(0, 1));
    other = ok[0] ?? null;
    pickErrors = rejected.map((r) => `${r.name}: ${r.reason}`);
  }

  /** The 0-based place the new pages go, from the "Where" choice. */
  function insertAt(): number {
    if (where === 'start') return 0;
    if (where === 'end') return file.pages;
    const n = Math.trunc(Number(pageNo));
    if (!(n >= 1 && n <= file.pages)) throw new Error(`Choose a page from 1 to ${file.pages}.`);
    return where === 'before' ? n - 1 : n;
  }

  function insert() {
    job.run(async () => {
      const at = insertAt();
      if (what === 'pdf' && !other) throw new Error('Choose the PDF to insert.');
      const blanks = Math.trunc(Number(count));
      if (what === 'blank' && !(blanks >= 1 && blanks <= 1000)) throw new Error('Add from 1 to 1000 blank pages.');
      const out = await runPdfJob({
        op: 'insertPages',
        file: copyBytes(file.bytes),
        files: what === 'pdf' && other ? [copyBytes(other.bytes)] : [],
        opts: { at, blankCount: blanks },
      });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-inserted'));
      const added = what === 'pdf' ? other!.pages : blanks;
      return `Added ${added} page${added === 1 ? '' : 's'}.${note}`;
    });
  }
</script>

<div class="panel">
  <div class="fields">
    <label class="field">Insert
      <select bind:value={what} data-testid="insert-what">
        <option value="blank">Blank pages</option>
        <option value="pdf">Pages from another PDF</option>
      </select>
    </label>
    {#if what === 'blank'}
      <label class="field">How many <input type="number" min="1" max="1000" bind:value={count} data-testid="insert-count" /></label>
    {/if}
    <label class="field">Where
      <select bind:value={where} data-testid="insert-where">
        <option value="start">At the start</option>
        <option value="before">Before page…</option>
        <option value="after">After page…</option>
        <option value="end">At the end</option>
      </select>
    </label>
    {#if where === 'before' || where === 'after'}
      <label class="field">Page <input type="number" min="1" max={file.pages} bind:value={pageNo} data-testid="insert-page" /></label>
    {/if}
  </div>
  {#if what === 'pdf'}
    {#if other}
      <p class="picked">
        Inserting <strong>{other.name}</strong> ({other.pages} page{other.pages === 1 ? '' : 's'})
        <button class="quiet" onclick={() => (other = null)} data-testid="insert-clear">Change</button>
      </p>
    {:else}
      <FilePicker multiple={false} compact title="Choose the PDF to insert" onFiles={pickOther} />
    {/if}
    <Notice messages={pickErrors} />
  {:else}
    <p class="muted">Blank pages get the same size as the page next to them.</p>
  {/if}
  <RemoveScriptsOption bind:checked={alsoClean} />
  <div class="actions">
    <button disabled={job.busy} onclick={insert} data-testid="run">{job.busy ? 'Working…' : 'Insert pages'}</button>
  </div>
</div>
<Notice messages={job.errors} />
<Notice kind="ok" messages={job.done} />

<style>
  .picked {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
