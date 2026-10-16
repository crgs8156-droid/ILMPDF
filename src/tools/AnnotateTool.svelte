<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import AnnotateEditor from './AnnotateEditor.svelte';
  import type { PdfFile } from '../core/files';
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <AnnotateEditor {file} />
  {/snippet}
</SinglePdf>
