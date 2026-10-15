<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import FormEditor from './FormEditor.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <FormEditor {file} />
  {/snippet}
</SinglePdf>
