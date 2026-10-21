<script lang="ts">
  import FilePicker from '../lib/FilePicker.svelte';
  import Notice from '../lib/Notice.svelte';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import { checkFileMeta, formatBytes, hasPdfHeader } from '../core/validate';
  import { MAX_FILES } from '../core/limits';
  import { saveBytes } from '../core/save';
  import { ToolRun } from '../core/run.svelte';
  import {
    BATCH_ACTIONS,
    MAX_BATCH_BYTES,
    batchZip,
    runBatch,
    zipName,
    type BatchAction,
    type BatchKind,
    type BatchResult,
  } from '../core/batch';
  import type { CompressLevel } from '../engines/mupdf-ops';
  import type { NumberPosition } from '../engines/pdflib-ops';

  type Item = { key: string; name: string; size: number; bytes: Uint8Array; result?: BatchResult | undefined };

  let items = $state<Item[]>([]);
  let rejected = $state<string[]>([]);
  let kind = $state<BatchKind>('compress');
  let alsoClean = $state(false);
  const job = new ToolRun();

  // Options, one set per action, with the same defaults as the single-file tools.
  let level = $state<CompressLevel>('recommended');
  let wmText = $state('CONFIDENTIAL');
  let wmSize = $state(60);
  let wmOpacity = $state(20);
  let wmDiagonal = $state(true);
  let position = $state<NumberPosition>('bottom-center');
  let format = $state<'n' | 'n-of-total'>('n');
  let startAt = $state(1);
  let numberSize = $state(11);
  // Passwords are held only in this component's memory and cleared when the batch starts.
  let password = $state('');
  let confirm = $state('');
  let allowPrint = $state(true);
  let allowCopy = $state(true);
  let allowEdit = $state(true);

  const totalBytes = $derived(items.reduce((n, i) => n + i.size, 0));
  const needsPassword = $derived(kind === 'protect' || kind === 'unlock');
  const passwordReady = $derived(
    kind === 'protect' ? password.length > 0 && confirm === password : kind === 'unlock' ? password.length > 0 : true,
  );
  const ready = $derived(items.length > 0 && passwordReady && !job.busy);

  // Only the basics are checked here. The engines read each file inside a
  // worker when the batch runs, so a damaged or locked file (which Repair and
  // Unlock exist for) still gets its turn and fails on its own if it must.
  async function add(files: File[]) {
    rejected = [];
    let size = totalBytes;
    for (const file of files) {
      if (items.length >= MAX_FILES) {
        rejected.push(`${file.name}: Limit of ${MAX_FILES} files reached`);
        continue;
      }
      const meta = checkFileMeta(file.name, file.size);
      if (!meta.ok) {
        rejected.push(`${file.name}: ${meta.reason}`);
        continue;
      }
      if (size + file.size > MAX_BATCH_BYTES) {
        rejected.push(`${file.name}: One batch can hold up to ${formatBytes(MAX_BATCH_BYTES)} of files`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!hasPdfHeader(bytes.subarray(0, 1024))) {
        rejected.push(`${file.name}: Not a real PDF (header missing)`);
        continue;
      }
      size += file.size;
      items.push({ key: crypto.randomUUID(), name: file.name, size: file.size, bytes });
    }
  }

  function remove(key: string) {
    items = items.filter((i) => i.key !== key);
  }

  function clear() {
    items = [];
    rejected = [];
    job.errors = [];
    job.done = [];
  }

  function action(): BatchAction {
    switch (kind) {
      case 'compress':
        return { kind, level };
      case 'watermark':
        return { kind, opts: { text: wmText, fontSize: Number(wmSize), opacity: Number(wmOpacity) / 100, diagonal: wmDiagonal } };
      case 'pageNumbers':
        return { kind, opts: { position, format, startAt: Number(startAt), fontSize: Number(numberSize) } };
      case 'protect':
        return { kind, opts: { password, allowPrint, allowCopy, allowEdit } };
      case 'unlock':
        return { kind, password };
      default:
        return { kind };
    }
  }

  function start() {
    const chosen = action();
    password = '';
    confirm = '';
    for (const item of items) item.result = undefined;
    job.run(async () => {
      const results = await runBatch(
        items.map((i) => ({ name: i.name, bytes: i.bytes })),
        chosen,
        alsoClean,
        (index, result) => {
          const item = items[index];
          if (item) item.result = result;
        },
      );
      const zip = batchZip(chosen.kind, results);
      const failed = results.filter((r) => r.error).length;
      if (!zip) throw new Error('None of the files could be processed, so nothing was saved. See the reasons in the list.');
      saveBytes(zip, zipName(chosen.kind), 'application/zip');
      const ok = results.length - failed;
      return `Saved ${ok} file${ok === 1 ? '' : 's'} and a short report as one ZIP.${failed ? ` ${failed} failed (see the list).` : ''}`;
    });
  }
</script>

{#if items.length > 0}
  <div class="panel">
    <div class="list-head">
      <strong>{items.length} file{items.length === 1 ? '' : 's'}</strong>
      <span class="muted">{formatBytes(totalBytes)}</span>
      <button type="button" class="quiet" disabled={job.busy} onclick={clear} data-testid="clear">Remove all</button>
    </div>
    <ol class="files" data-testid="batch-files">
      {#each items as item (item.key)}
        <li data-testid="batch-file">
          <span class="name">{item.name}</span>
          {#if item.result?.error}
            <span class="status bad" data-testid="batch-failed">Failed: {item.result.error}</span>
          {:else if item.result}
            <span class="status good" data-testid="batch-ok">Done{item.result.note ? `: ${item.result.note}` : ''}</span>
          {:else}
            <span class="status muted">{formatBytes(item.size)}</span>
          {/if}
          <button type="button" class="quiet" disabled={job.busy} onclick={() => remove(item.key)} aria-label="Remove {item.name}">✕</button>
        </li>
      {/each}
    </ol>
    {#if items.length < MAX_FILES}<FilePicker compact title="Add more PDFs" onFiles={add} />{/if}
  </div>

  <form
    class="panel"
    onsubmit={(e) => {
      e.preventDefault();
      if (ready) start();
    }}
  >
    <label class="field">
      Action for every file
      <select bind:value={kind} disabled={job.busy} data-testid="batch-action">
        {#each Object.entries(BATCH_ACTIONS) as [id, a] (id)}<option value={id}>{a.label}</option>{/each}
      </select>
    </label>

    {#if kind === 'compress'}
      <label class="field">
        How much
        <select bind:value={level} data-testid="batch-level">
          <option value="light">Light (no quality loss)</option>
          <option value="recommended">Recommended (images up to 150 dpi)</option>
          <option value="strong">Strong (images up to 100 dpi)</option>
        </select>
      </label>
    {:else if kind === 'watermark'}
      <div class="fields">
        <label class="field">Text <input type="text" maxlength="200" bind:value={wmText} data-testid="wm-text" /></label>
        <label class="field">Text size <input type="number" min="8" max="200" bind:value={wmSize} /></label>
        <label class="field">Opacity % <input type="number" min="5" max="100" bind:value={wmOpacity} /></label>
        <label class="check"><input type="checkbox" bind:checked={wmDiagonal} /> Diagonal</label>
      </div>
    {:else if kind === 'pageNumbers'}
      <div class="fields">
        <label class="field">Position
          <select bind:value={position}>
            <option value="bottom-center">Bottom centre</option>
            <option value="bottom-right">Bottom right</option>
            <option value="top-center">Top centre</option>
            <option value="top-right">Top right</option>
          </select>
        </label>
        <label class="field">Style
          <select bind:value={format}>
            <option value="n">1, 2, 3</option>
            <option value="n-of-total">1 of N</option>
          </select>
        </label>
        <label class="field">Start at <input type="number" min="0" bind:value={startAt} /></label>
        <label class="field">Text size <input type="number" min="6" max="48" bind:value={numberSize} /></label>
      </div>
    {:else if kind === 'protect'}
      <div class="fields">
        <label class="field">
          Password for all files
          <input type="password" bind:value={password} autocomplete="new-password" spellcheck="false" maxlength="127" data-testid="password" />
        </label>
        <label class="field">
          Type it again
          <input type="password" bind:value={confirm} autocomplete="new-password" spellcheck="false" maxlength="127" data-testid="confirm" />
        </label>
      </div>
      {#if confirm.length > 0 && confirm !== password}<p class="warn" data-testid="mismatch">The two passwords don't match.</p>{/if}
      <div class="fields">
        <label class="check"><input type="checkbox" bind:checked={allowPrint} /> Allow printing</label>
        <label class="check"><input type="checkbox" bind:checked={allowCopy} /> Allow copying</label>
        <label class="check"><input type="checkbox" bind:checked={allowEdit} /> Allow editing</label>
      </div>
      <p class="muted">Every file gets the same password (AES-256). ILMPDF never stores it, and it cannot be recovered.</p>
    {:else if kind === 'unlock'}
      <label class="field">
        Password (the same one for every file)
        <input type="password" bind:value={password} autocomplete="off" spellcheck="false" data-testid="password" />
      </label>
      <p class="muted">Files that need a different password, or have none, are listed as failed. ILMPDF never guesses passwords.</p>
    {:else if kind === 'sanitize'}
      <p class="muted">Strips JavaScript, auto-run actions and attached files from every file.</p>
    {:else if kind === 'stripMetadata'}
      <p class="muted">Removes title, author, subject, keywords, creating app, dates and XMP metadata. Pages are untouched.</p>
    {:else if kind === 'repair'}
      <p class="muted">Rebuilds each file's internal index and rewrites it cleanly.</p>
    {/if}

    {#if kind !== 'sanitize'}<RemoveScriptsOption bind:checked={alsoClean} />{/if}
    <p class="muted">Files are processed one at a time on this Mac. The originals are unchanged; results download as one ZIP.</p>
    <div class="actions">
      <button type="submit" disabled={!ready} data-testid="run">
        {job.busy ? 'Working…' : `Run on ${items.length} file${items.length === 1 ? '' : 's'}`}
      </button>
    </div>
  </form>
  <Notice messages={job.errors} />
  <Notice kind="ok" messages={job.done} />
{:else}
  <FilePicker title="Drop PDFs here" hint={`Up to ${MAX_FILES} files. They stay on this Mac.`} onFiles={add} />
{/if}
<Notice messages={rejected} />

<style>
  .list-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }
  .list-head button {
    margin-left: auto;
  }
  .files {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .files li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 0 1 auto;
  }
  .status {
    flex: 1 1 auto;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .good {
    color: var(--good);
  }
  .bad {
    color: var(--bad);
  }
  .warn {
    color: var(--bad);
    font-size: 14px;
    margin: 4px 0;
  }
</style>
