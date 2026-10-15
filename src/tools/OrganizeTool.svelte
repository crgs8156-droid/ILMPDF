<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import PageGrid from './PageGrid.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <PageGrid {file} />
  {/snippet}
</SinglePdf>
