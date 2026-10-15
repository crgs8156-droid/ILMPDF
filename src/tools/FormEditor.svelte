<script lang="ts">
  import { onMount } from 'svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import type { FormField, FormValues } from '../engines/mupdf-ops';

  // Field names and labels come from the PDF: they are shown only through
  // normal {text} interpolation, never as HTML.
  type Props = { file: PdfFile };
  let { file }: Props = $props();

  let fields = $state<FormField[] | null>(null);
  let flatten = $state(false);
  const reading = new ToolRun();
  const job = new ToolRun();

  // Read the fields once, when this file is shown.
  onMount(() => {
    reading.run(async () => {
      const out = await runMupdfJob({ op: 'readForm', file: copyBytes(file.bytes) });
      fields = out.fields ?? [];
    });
  });

  function save() {
    if (!fields) return;
    const values: FormValues = fields
      .filter((f) => !f.readOnly)
      .map((f) => [f.name, f.kind === 'checkbox' ? f.checked : f.value]);
    const flat = flatten;
    job.run(async () => {
      const out = await runMupdfJob({ op: 'fillForm', file: copyBytes(file.bytes), values, flatten: flat });
      saveBytes(out.files![0]!, safeFileName(file.name, flat ? '-flattened' : '-filled'));
      return flat
        ? 'Saved a flattened copy: the answers are now part of the pages and can no longer be edited.'
        : 'Saved a filled copy. Its fields can still be edited.';
    });
  }
</script>

{#if reading.busy}<p class="muted">Reading the form…</p>{/if}
<Notice messages={reading.errors} />
{#if fields && fields.length === 0}
  <p class="muted" data-testid="no-fields">This PDF has no fillable fields.</p>
{:else if fields}
  <form
    class="panel"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <div class="fields">
      {#each fields as field (field.name)}
        {#if field.kind === 'checkbox'}
          <label class="check">
            <input type="checkbox" bind:checked={field.checked} disabled={field.readOnly} data-testid="field-{field.name}" />
            {field.label}
          </label>
        {:else if field.kind === 'radio'}
          <fieldset disabled={field.readOnly}>
            <legend>{field.label}</legend>
            {#each field.options as option, i (i)}
              <label class="check">
                <input type="radio" name="radio-{field.name}" value={option} bind:group={field.value} data-testid="field-{field.name}-{i}" />
                {option}
              </label>
            {/each}
          </fieldset>
        {:else if field.kind === 'choice'}
          <label class="field">
            {field.label}
            <select bind:value={field.value} disabled={field.readOnly} data-testid="field-{field.name}">
              <option value="">(none)</option>
              {#each field.options as option, i (i)}<option value={option}>{option}</option>{/each}
            </select>
          </label>
        {:else if field.multiline}
          <label class="field">
            {field.label}
            <textarea bind:value={field.value} disabled={field.readOnly} maxlength={field.maxLen || 10000} rows="4" data-testid="field-{field.name}"></textarea>
          </label>
        {:else}
          <label class="field">
            {field.label}
            <input type="text" bind:value={field.value} disabled={field.readOnly} maxlength={field.maxLen || 10000} data-testid="field-{field.name}" />
          </label>
        {/if}
      {/each}
    </div>
    <label class="check flatten">
      <input type="checkbox" bind:checked={flatten} data-testid="flatten" />
      Flatten: make the answers part of the page so they can't be changed
    </label>
    <div class="actions">
      <button type="submit" disabled={job.busy} data-testid="run">{job.busy ? 'Saving…' : 'Save filled PDF'}</button>
    </div>
  </form>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{/if}

<style>
  .fields {
    display: grid;
    gap: 12px;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px 12px;
    display: grid;
    gap: 6px;
  }
  legend {
    font-size: 14px;
    padding: 0 4px;
  }
  textarea {
    font: inherit;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .flatten {
    margin: 16px 0 4px;
  }
</style>
