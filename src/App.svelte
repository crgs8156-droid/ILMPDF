<script lang="ts">
  import DropZone from './lib/DropZone.svelte';
  import SecurityBadge from './lib/SecurityBadge.svelte';
  import { runInspectJob } from './core/orchestrator';
  import { checkFileMeta, formatBytes, safeFileName } from './core/validate';
  import { MAX_FILES } from './core/limits';
  import { saveBytes } from './core/save';

  type Entry = {
    key: string;
    name: string;
    size: number;
    status: 'checking' | 'ready' | 'rejected';
    note: string;
    buffer: ArrayBuffer | null;
  };

  let entries = $state<Entry[]>([]);

  function update(key: string, patch: Partial<Entry>) {
    entries = entries.map((e) => (e.key === key ? { ...e, ...patch } : e));
  }

  async function addFiles(files: File[]) {
    const room = MAX_FILES - entries.length;
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = crypto.randomUUID();
      const meta = checkFileMeta(file.name, file.size);
      entries = [
        ...entries,
        {
          key,
          name: file.name,
          size: file.size,
          status: meta.ok ? 'checking' : 'rejected',
          note: meta.ok ? 'Checking…' : meta.reason,
          buffer: null,
        },
      ];
      if (!meta.ok) continue;
      try {
        const result = await runInspectJob(await file.arrayBuffer());
        update(key, result.isPdf
          ? { status: 'ready', note: 'Valid PDF header', buffer: result.buffer }
          : { status: 'rejected', note: 'Not a real PDF (header missing)' });
      } catch (err) {
        update(key, { status: 'rejected', note: err instanceof Error ? err.message : 'Failed' });
      }
    }
  }

  function remove(key: string) {
    // Dropping the reference lets the browser free the file's memory.
    entries = entries.filter((e) => e.key !== key);
  }

  function save(entry: Entry) {
    if (entry.buffer) saveBytes(entry.buffer, safeFileName(entry.name, '-ilmpdf'));
  }
</script>

<main>
  <header>
    <h1>ILMPDF</h1>
    <SecurityBadge />
  </header>

  <DropZone onFiles={addFiles} />

  {#if entries.length > 0}
    <ul class="files" data-testid="file-list">
      {#each entries as entry (entry.key)}
        <li data-testid="file-row" data-status={entry.status}>
          <div class="meta">
            <span class="name">{entry.name}</span>
            <span class="detail">{formatBytes(entry.size)} · {entry.note}</span>
          </div>
          <div class="actions">
            {#if entry.status === 'ready'}
              <button type="button" onclick={() => save(entry)} data-testid="save">Save copy</button>
            {/if}
            <button type="button" class="quiet" onclick={() => remove(entry.key)}>Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <footer>Phase 0 shell. PDF tools arrive in Phase 1.</footer>
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: grid;
    gap: 20px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  li[data-status='rejected'] .detail {
    color: var(--bad);
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
  .actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  button {
    font: inherit;
    font-size: 14px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
    cursor: pointer;
  }
  button.quiet {
    background: transparent;
    color: var(--text);
    border-color: var(--border);
  }
  footer {
    color: var(--muted);
    font-size: 13px;
  }
</style>
