<script lang="ts">
  // Page tools: three small jobs on one screen, picked with "What to do".
  import SinglePdf from '../lib/SinglePdf.svelte';
  import PageResizePanel from './PageResizePanel.svelte';
  import PageInsertPanel from './PageInsertPanel.svelte';
  import PageBlankPanel from './PageBlankPanel.svelte';
  import type { PdfFile } from '../core/files';

  let mode = $state<'resize' | 'insert' | 'blank'>('resize');
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="fields">
      <label class="field">What to do
        <select bind:value={mode} data-testid="page-tools-mode">
          <option value="resize">Resize pages</option>
          <option value="insert">Insert pages</option>
          <option value="blank">Remove blank pages</option>
        </select>
      </label>
    </div>
    {#if mode === 'resize'}
      <PageResizePanel {file} />
    {:else if mode === 'insert'}
      <PageInsertPanel {file} />
    {:else}
      <PageBlankPanel {file} />
    {/if}
  {/snippet}
</SinglePdf>
