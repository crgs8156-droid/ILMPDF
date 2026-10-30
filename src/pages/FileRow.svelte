<script lang="ts">
  // One row in Recent files, Your files or Saved files.
  import type { Snippet } from 'svelte';
  type Props = { name: string; detail: string; kind?: 'pdf' | 'out'; actions: Snippet };
  let { name, detail, kind = 'pdf', actions }: Props = $props();
  const ext = $derived((name.match(/\.([a-z0-9]{1,4})$/i)?.[1] ?? 'file').toUpperCase());
</script>

<li class="row" data-testid="file-row">
  <span class="thumb" class:out={kind === 'out'} aria-hidden="true">{ext}</span>
  <span class="meta">
    <span class="name">{name}</span>
    <span class="detail">{detail}</span>
  </span>
  <span class="acts">{@render actions()}</span>
</li>

<style>
  .row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
  .row:first-child {
    border-top: 0;
  }
  .thumb {
    display: grid;
    place-items: center;
    width: 32px;
    height: 40px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    font-size: 8px;
    font-weight: 700;
    color: var(--bad);
  }
  .thumb.out {
    color: var(--good);
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
    font-size: 12.5px;
    color: var(--muted);
  }
  .acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .acts :global(button),
  .acts :global(select) {
    font-size: 13px;
    padding: 5px 10px;
  }
  .acts :global(select) {
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text);
  }
  @media (max-width: 560px) {
    .row {
      grid-template-columns: 32px minmax(0, 1fr);
    }
    .acts {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
  }
</style>
