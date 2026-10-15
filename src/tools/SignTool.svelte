<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import SignEditor from './SignEditor.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <SignEditor {file} />
  {/snippet}
</SinglePdf>
