<script lang="ts" module>
  import type { Bookmark } from '../engines/mupdf-bookmarks';
  /** A bookmark in the editor; `key` only keeps Svelte's list rows stable. */
  export type Row = Bookmark & { key: number };
</script>

<script lang="ts">
  import { MAX_BOOKMARKS, MAX_TITLE } from '../engines/mupdf-bookmarks';
  import { canIndent, canMoveDown, canMoveUp, canOutdent, moveDown, moveUp, remove, shift } from '../core/bookmarks';

  type Props = { rows: Row[]; pages: number; newKey: () => number };
  let { rows = $bindable(), pages, newKey }: Props = $props();

  // The page box shows 1-based page numbers; empty means "no page".
  function pageOf(row: Row): number | null {
    return row.page === null ? null : row.page + 1;
  }
  function setPage(i: number, value: number | null | undefined) {
    const n = typeof value === 'number' && Number.isInteger(value) ? Math.min(Math.max(value, 1), pages) - 1 : null;
    rows[i] = { ...rows[i]!, page: n };
  }

  function add() {
    const last = rows[rows.length - 1];
    rows = [...rows, { key: newKey(), title: 'New bookmark', page: last?.page ?? 0, level: 0, open: false }];
  }
</script>

{#if rows.length === 0}
  <p class="muted" data-testid="bm-empty">This PDF has no bookmarks. Add one below.</p>
{:else}
  <ol class="tree" data-testid="bm-list">
    {#each rows as row, i (row.key)}
      <li data-testid="bm-row">
        {#each { length: Math.min(row.level, 8) } as _}<span class="indent" aria-hidden="true"></span>{/each}
        <input
          type="text"
          class="title"
          maxlength={MAX_TITLE}
          aria-label={`Title of bookmark ${i + 1}`}
          bind:value={row.title}
          data-testid="bm-title"
        />
        <label class="page">p.
          <input
            type="number"
            min="1"
            max={pages}
            placeholder="none"
            aria-label={`Page of bookmark ${i + 1}`}
            bind:value={() => pageOf(row), (v) => setPage(i, v)}
            data-testid="bm-page"
          />
        </label>
        <span class="buttons">
          <button type="button" class="quiet icon" aria-label="Move up" disabled={!canMoveUp(rows, i)} onclick={() => (rows = moveUp(rows, i))}>↑</button>
          <button type="button" class="quiet icon" aria-label="Move down" disabled={!canMoveDown(rows, i)} onclick={() => (rows = moveDown(rows, i))}>↓</button>
          <button type="button" class="quiet icon" aria-label="Outdent" disabled={!canOutdent(rows, i)} onclick={() => (rows = shift(rows, i, -1))} data-testid="bm-outdent">←</button>
          <button type="button" class="quiet icon" aria-label="Indent" disabled={!canIndent(rows, i)} onclick={() => (rows = shift(rows, i, 1))} data-testid="bm-indent">→</button>
          <button type="button" class="quiet icon" aria-label="Delete" onclick={() => (rows = remove(rows, i))} data-testid="bm-delete">✕</button>
        </span>
      </li>
    {/each}
  </ol>
{/if}
<div class="actions">
  <button type="button" class="quiet" disabled={rows.length >= MAX_BOOKMARKS} onclick={add} data-testid="bm-add">Add bookmark</button>
  {#if rows.length > 0}
    <button type="button" class="quiet" onclick={() => (rows = [])} data-testid="bm-clear">Remove all</button>
  {/if}
</div>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-height: 60vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .indent {
    flex: none;
    width: 20px;
    align-self: stretch;
    border-left: 1px solid var(--border);
  }
  .title {
    flex: 1 1 auto;
    min-width: 6em;
  }
  .page {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .page input {
    width: 5em;
  }
  .buttons {
    display: flex;
    flex: none;
  }
</style>
