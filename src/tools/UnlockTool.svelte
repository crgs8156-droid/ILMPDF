<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { checkFileMeta, formatBytes, hasPdfHeader, safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';
  import type { PdfInfo } from '../engines/mupdf-ops';

  type Locked = { name: string; size: number; bytes: Uint8Array; info: PdfInfo };

  let file = $state<Locked | null>(null);
  let errors = $state<string[]>([]);
  let loading = $state(false);
  // Held only in this component's memory; cleared after every attempt.
  let password = $state('');
  const job = new ToolRun();

  // pdf-lib refuses encrypted files, so this tool reads them with MuPDF instead.
  async function pick(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    errors = [];
    file = null;
    const meta = checkFileMeta(picked.name, picked.size);
    if (!meta.ok) return void (errors = [`${picked.name}: ${meta.reason}`]);
    const bytes = new Uint8Array(await picked.arrayBuffer());
    if (!hasPdfHeader(bytes.subarray(0, 1024))) return void (errors = [`${picked.name}: Not a real PDF (header missing)`]);
    loading = true;
    try {
      const { info } = await runMupdfJob({ op: 'inspect', file: copyBytes(bytes) });
      if (!info?.encrypted) errors = [`${picked.name}: This PDF isn't password-protected, so there is nothing to unlock.`];
      else file = { name: picked.name, size: picked.size, bytes, info };
    } catch (err) {
      errors = [`${picked.name}: ${err instanceof Error ? err.message : 'Could not read'}`];
    } finally {
      loading = false;
    }
  }

  function unlock(f: Locked) {
    const typed = password;
    password = '';
    job.run(async () => {
      const out = await runMupdfJob({ op: 'unlock', file: copyBytes(f.bytes), password: typed });
      saveBytes(out.files![0]!, safeFileName(f.name, '-unlocked'));
      return 'Saved an unlocked copy. The original file is unchanged.';
    });
  }

  function clear() {
    file = null;
    password = '';
    job.errors = [];
    job.done = [];
  }
</script>

{#if file}
  <div class="head" data-testid="loaded-file">
    <div class="meta">
      <span class="name">{file.name}</span>
      <span class="detail">
        {file.info.needsPassword ? 'Needs a password to open' : 'Opens freely but has restrictions'} · {formatBytes(file.size)}
      </span>
    </div>
    <button type="button" class="quiet" onclick={clear}>Choose another file</button>
  </div>
  <form
    class="panel"
    onsubmit={(e) => {
      e.preventDefault();
      if (file && password) unlock(file);
    }}
  >
    <label class="field">
      {file.info.needsPassword ? 'Password' : 'Owner password (to remove restrictions)'}
      <input
        type="password"
        bind:value={password}
        autocomplete="off"
        spellcheck="false"
        data-testid="password"
      />
    </label>
    <p class="muted">
      Use a password you already know. ILMPDF never guesses or cracks passwords, and never stores what you type.
    </p>
    <div class="actions">
      <button type="submit" disabled={job.busy || !password} data-testid="run">{job.busy ? 'Unlocking…' : 'Unlock PDF'}</button>
    </div>
  </form>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{:else}
  <FilePicker multiple={false} title="Drop a password-protected PDF here" onFiles={pick} />
  {#if loading}<p class="muted">Reading…</p>{/if}
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
