<script lang="ts">
  import type { Snippet } from 'svelte';
  import FilePicker from './FilePicker.svelte';
  import PdfHeader from './PdfHeader.svelte';
  import Notice from './Notice.svelte';
  import { loadPdfs, type PdfFile } from '../core/files';

  type Props = { children: Snippet<[PdfFile]> };
  let { children }: Props = $props();

  let file = $state<PdfFile | null>(null);
  let loading = $state(false);
  let errors = $state<string[]>([]);

  async function pick(files: File[]) {
    loading = true;
    errors = [];
    const { ok, rejected } = await loadPdfs(files.slice(0, 1));
    file = ok[0] ?? null;
    errors = rejected.map((r) => `${r.name}: ${r.reason}`);
    loading = false;
  }
</script>

{#if file}
  <PdfHeader {file} onClear={() => (file = null)} />
  {#key file.key}{@render children(file)}{/key}
{:else}
  <FilePicker multiple={false} title="Drop a PDF here" onFiles={pick} />
  {#if loading}<p class="muted">Reading…</p>{/if}
{/if}
<Notice messages={errors} />
