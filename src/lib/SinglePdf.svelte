<script lang="ts">
  import type { Snippet } from 'svelte';
  import FilePicker from './FilePicker.svelte';
  import PdfHeader from './PdfHeader.svelte';
  import Notice from './Notice.svelte';
  import { loadPdfs, type PdfFile } from '../core/files';
  import { nav } from '../core/nav.svelte';
  import { parentOf } from '../core/router';

  type Props = { children: Snippet<[PdfFile]> };
  let { children }: Props = $props();

  let file = $state<PdfFile | null>(null);
  let loading = $state(false);
  let errors = $state<string[]>([]);
  let lost = $state(false);
  // Whether the address said "file loaded" last time the effect below ran.
  let wasOnFile = false;

  async function pick(files: File[]) {
    loading = true;
    errors = [];
    lost = false;
    const { ok, rejected } = await loadPdfs(files.slice(0, 1));
    file = ok[0] ?? null;
    errors = rejected.map((r) => `${r.name}: ${r.reason}`);
    loading = false;
    // A loaded file is its own step in the history (#/tool/file), so
    // Safari's Back returns to the file picker before leaving the tool.
    if (file && nav.route.kind === 'tool' && !nav.route.file) nav.go({ ...nav.route, file: true });
  }

  function clear() {
    if (nav.onFile) nav.up();
    else file = null;
  }

  // Keeps the loaded file in step with the address:
  // - Back (or "Choose another file") left the file step: forget the file.
  // - Forward, a reload or a link landed on the file step, but the file is
  //   gone (it is never kept): step back to the picker and say why.
  $effect(() => {
    const onFile = nav.onFile;
    if (wasOnFile && !onFile) file = null;
    else if (onFile && !wasOnFile && !file && !loading) {
      lost = true;
      nav.replace(parentOf(nav.route));
    }
    wasOnFile = onFile;
  });
</script>

{#if file}
  <PdfHeader {file} onClear={clear} />
  {#key file.key}{@render children(file)}{/key}
{:else}
  {#if lost}
    <Notice kind="info" messages={['That PDF was closed when you left it: ILMPDF never keeps files. Choose it again to carry on.']} />
  {/if}
  <FilePicker multiple={false} title="Drop a PDF here" onFiles={pick} />
  {#if loading}<p class="muted">Reading…</p>{/if}
{/if}
<Notice messages={errors} />
