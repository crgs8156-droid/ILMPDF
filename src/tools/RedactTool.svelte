<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import RedactEditor from './RedactEditor.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <RedactEditor {file} />
  {/snippet}
</SinglePdf>
