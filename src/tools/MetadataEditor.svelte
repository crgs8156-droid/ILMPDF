<script lang="ts">
  import { onMount } from 'svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runPdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import { cleanIf } from '../core/clean';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import { EDITABLE_KEYS, MAX_FIELD_LENGTH, type EditableKey } from '../engines/metadata-edit';

  // Metadata values come from the PDF: they are shown only through normal
  // {text} interpolation and input values, never as HTML.
  type Props = { file: PdfFile };
  let { file }: Props = $props();

  const LABELS: Record<EditableKey, string> = {
    Title: 'Title',
    Author: 'Author',
    Subject: 'Subject',
    Keywords: 'Keywords',
    Creator: 'Created with (app)',
    Producer: 'PDF made by (app)',
  };

  let meta = $state<Record<string, string> | null>(null);
  let values = $state<Record<EditableKey, string>>({ Title: '', Author: '', Subject: '', Keywords: '', Creator: '', Producer: '' });
  let touchModified = $state(false);
  let alsoClean = $state(false);
  const reading = new ToolRun();
  const job = new ToolRun();

  const dateText = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString() : 'not set');

  // Read the details once, when this file is shown.
  onMount(() => {
    reading.run(async () => {
      const out = await runPdfJob({ op: 'readMetadata', file: copyBytes(file.bytes) });
      meta = out.meta ?? {};
      for (const key of EDITABLE_KEYS) values[key] = meta[key] ?? '';
    });
  });

  function save() {
    const edit = { values: { ...values }, touchModified };
    job.run(async () => {
      const out = await runPdfJob({ op: 'editMetadata', file: copyBytes(file.bytes), edit });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-edited'));
      return `Saved a copy with the new details.${note}`;
    });
  }

  function strip() {
    job.run(async () => {
      const out = await runPdfJob({ op: 'stripMetadata', file: copyBytes(file.bytes) });
      const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
      saveBytes(saved!, safeFileName(file.name, '-clean'));
      return `Saved a copy with the metadata removed.${note}`;
    });
  }
</script>

{#if !meta}
  {#if reading.busy}<p class="muted">Reading metadata…</p>{/if}
  <Notice messages={reading.errors} />
{:else}
  <form
    class="panel"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    {#if Object.keys(meta).length === 0}
      <p data-testid="meta-empty">No document metadata found. You can add some below.</p>
    {/if}
    <div class="fields" data-testid="meta-list">
      {#each EDITABLE_KEYS as key (key)}
        <label class="field">
          {LABELS[key]}
          <input type="text" bind:value={values[key]} maxlength={MAX_FIELD_LENGTH} data-testid="meta-{key}" />
        </label>
      {/each}
    </div>
    <dl class="dates">
      <dt>Created</dt><dd>{dateText(meta.Created)}</dd>
      <dt>Modified</dt><dd>{dateText(meta.Modified)}</dd>
      {#if meta['XMP metadata']}<dt>XMP copy</dt><dd>present (replaced when you save changes)</dd>{/if}
    </dl>
    <label class="check">
      <input type="checkbox" bind:checked={touchModified} data-testid="meta-touch" />
      Set "Modified" to now
    </label>
    <RemoveScriptsOption bind:checked={alsoClean} />
    <p class="muted">An empty box removes that detail. Page content is untouched.</p>
    <div class="actions">
      <button type="submit" disabled={job.busy} data-testid="meta-save">{job.busy ? 'Working…' : 'Save changes'}</button>
      <button type="button" class="quiet" disabled={job.busy} onclick={strip} data-testid="run">Remove all metadata</button>
    </div>
  </form>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{/if}

<style>
  .fields {
    display: grid;
    gap: 10px;
  }
  .dates {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 14px 0 8px;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
