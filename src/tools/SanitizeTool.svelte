<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { checkFileMeta, formatBytes, hasPdfHeader, safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import type { SanitizeReport } from '../engines/mupdf-ops';

  type Picked = { name: string; size: number; bytes: Uint8Array };

  let file = $state<Picked | null>(null);
  let errors = $state<string[]>([]);
  const job = new ToolRun();

  // Like Repair, this only checks the basics here and lets MuPDF (in its
  // worker) read the file, so PDFs that pdf-lib dislikes still work.
  async function pick(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    errors = [];
    file = null;
    job.errors = [];
    job.done = [];
    const meta = checkFileMeta(picked.name, picked.size);
    if (!meta.ok) return void (errors = [`${picked.name}: ${meta.reason}`]);
    const bytes = new Uint8Array(await picked.arrayBuffer());
    if (!hasPdfHeader(bytes.subarray(0, 1024))) return void (errors = [`${picked.name}: Not a real PDF (header missing)`]);
    file = { name: picked.name, size: picked.size, bytes };
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  /** Turns the counts into a short list such as "2 scripts, 1 attached file". */
  function describe(r: SanitizeReport): string {
    const parts = [
      r.scripts && plural(r.scripts, 'script', 'scripts'),
      r.autoActions && plural(r.autoActions, 'automatic action', 'automatic actions'),
      r.openers && plural(r.openers, 'action that opens programs or other files', 'actions that open programs or other files'),
      r.dataActions && plural(r.dataActions, 'form action that sends or loads data', 'form actions that send or load data'),
      r.attachments && plural(r.attachments, 'attached file', 'attached files'),
      r.xfa && 'an XFA form layer',
    ].filter(Boolean);
    return parts.join(', ');
  }

  function clean(f: Picked) {
    job.run(async () => {
      const out = await runMupdfJob({ op: 'sanitize', file: copyBytes(f.bytes) });
      const cleaned = out.files?.[0];
      if (!cleaned) return 'Nothing to remove: this PDF has no scripts, automatic actions or attached files. No new file was saved.';
      saveBytes(cleaned, safeFileName(f.name, '-clean'));
      return `Removed ${describe(out.removed!)}. Saved a clean copy; the original file is unchanged.`;
    });
  }

  function clear() {
    file = null;
    job.errors = [];
    job.done = [];
  }
</script>

{#if file}
  <div class="head" data-testid="loaded-file">
    <div class="meta">
      <span class="name">{file.name}</span>
      <span class="detail">{formatBytes(file.size)}</span>
    </div>
    <button type="button" class="quiet" onclick={clear}>Choose another file</button>
  </div>
  <div class="panel">
    <p class="muted">
      Removes JavaScript, actions that run by themselves (on opening, closing, printing or saving), actions that launch
      programs, open other files or send form data, XFA forms and attached files. ILMPDF never runs these, but other apps
      such as Acrobat might. Pages, text, images, bookmarks, form fields and links are kept. Password-protected PDFs need
      to be unlocked first.
    </p>
    <div class="actions">
      <button type="button" disabled={job.busy} onclick={() => file && clean(file)} data-testid="run">
        {job.busy ? 'Removing…' : 'Remove scripts'}
      </button>
    </div>
  </div>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{:else}
  <FilePicker multiple={false} title="Drop a PDF here" onFiles={pick} />
{/if}
<Notice messages={errors} />

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .meta {
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    color: var(--muted);
    font-size: 13px;
  }
</style>
