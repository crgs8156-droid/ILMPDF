<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import CropEditor from './CropEditor.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <CropEditor {file} />
  {/snippet}
</SinglePdf>
