<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import FilePicker from './FilePicker.svelte';
  import PdfHeader from './PdfHeader.svelte';
  import Notice from './Notice.svelte';
  import { loadPdfs, type PdfFile } from '../core/files';
  import { nav } from '../core/nav.svelte';
  import { parentOf } from '../core/router';
  import { shelf } from '../core/shelf.svelte';

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
    errors = rejected.map((r) => `${r.name}: ${r.reason}`);
    loading = false;
    if (ok[0]) show(ok[0]);
  }

  /** Uses a PDF from Your files, without choosing it again. */
  function reuse(id: number) {
    const tool = nav.route.kind === 'tool' ? nav.route.id : null;
    const f = tool ? shelf.copyFor(id, tool) : null;
    if (f) show(f);
  }

  function show(f: PdfFile) {
    errors = [];
    lost = false;
    file = f;
    // A loaded file is its own step in the history (#/tool/file), so
    // Safari's Back returns to the file picker before leaving the tool.
    if (nav.route.kind === 'tool' && !nav.route.file) nav.go({ ...nav.route, file: true });
  }

  // "Open in…" on Recent files or Your files: the chosen PDF is waiting.
  onMount(() => {
    const tool = nav.route.kind === 'tool' ? nav.route.id : null;
    const waiting = tool ? shelf.takePending(tool) : null;
    if (waiting) show(waiting);
  });

  function clear() {
    if (nav.onFile) nav.up();
    else file = null;
  }

  // Keeps the loaded file in step with the address:
  // - Back (or "Choose another file") left the file step: forget the file.
  // - Forward, a reload or a link landed on the file step, but the tool has
  //   no file any more: step back to the picker and say why.
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
    <Notice kind="info" messages={['That PDF was closed when you left the tool. Pick it again to carry on.']} />
  {/if}
  <FilePicker multiple={false} title="Drop a PDF here" onFiles={pick} />
  {#if shelf.files.length > 0}
    <div class="yours" data-testid="your-files-picker">
      <span>Or use one of your files:</span>
      <div class="chips">
        {#each shelf.files.slice(0, 8) as f (f.id)}
          <button type="button" class="quiet" onclick={() => reuse(f.id)} data-testid="reuse-file">{f.name}</button>
        {/each}
      </div>
    </div>
  {/if}
  {#if loading}<p class="muted">Reading…</p>{/if}
{/if}
<Notice messages={errors} />

<style>
  .yours {
    display: grid;
    gap: 8px;
    font-size: 13px;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips button {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    padding: 5px 12px;
    border-radius: 999px;
  }
</style>
