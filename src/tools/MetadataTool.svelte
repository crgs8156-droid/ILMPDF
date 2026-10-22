<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import MetadataEditor from './MetadataEditor.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <MetadataEditor {file} />
  {/snippet}
</SinglePdf>
