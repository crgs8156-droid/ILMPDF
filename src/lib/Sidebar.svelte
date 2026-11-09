<script lang="ts">
  // The left-hand menu: the dashboard, then every tool by group. A group
  // opens to list its tools; the group of the open tool is always open.
  import { SvelteSet } from 'svelte/reactivity';
  import Icon from './Icon.svelte';
  import { UI_ICONS, groupClass } from './icons';
  import { TOOLS } from '../tools/registry';
  import { shelf } from '../core/shelf.svelte';
  import type { PageId } from '../core/router';

  type Props = { here: string | null; onDashboard: boolean; page: PageId | null; onClose: () => void };
  let { here, onDashboard, page, onClose }: Props = $props();

  const FILE_PAGES: { id: PageId; label: string; icon: string; count: () => number }[] = [
    { id: 'recent', label: 'Recent files', icon: UI_ICONS.clock, count: () => shelf.recent.length },
    { id: 'files', label: 'Your files', icon: UI_ICONS.folder, count: () => shelf.files.length },
    { id: 'saved', label: 'Saved files', icon: UI_ICONS.saved, count: () => shelf.saved.length },
  ];
  // "Clear all files" asks once, in place, before forgetting everything.
  let confirming = $state(false);
  const empty = $derived(shelf.files.length + shelf.saved.length + shelf.recent.length === 0);

  const groups = [...new Set(TOOLS.map((t) => t.group))];
  const opened = new SvelteSet<string>();
  const hereGroup = $derived(TOOLS.find((t) => t.id === here)?.group);

  function toggle(group: string) {
    if (opened.has(group)) opened.delete(group);
    else opened.add(group);
  }
</script>

<aside class="side" aria-label="Menu" data-testid="sidebar">
  <div class="top">
    <a href="#/" class="brand" onclick={onClose}>
      <span class="mark"><Icon d={UI_ICONS.mark} size={18} /></span>
      ILMPDF
    </a>
    <button type="button" class="quiet close" aria-label="Close menu" onclick={onClose}>
      <Icon d={UI_ICONS.close} size={18} />
    </button>
  </div>

  <nav class="items">
    <a href="#/" class="item" aria-current={onDashboard ? 'page' : undefined} onclick={onClose} data-testid="side-dashboard">
      <Icon d={UI_ICONS.dashboard} />
      Dashboard
    </a>
    {#each FILE_PAGES as p (p.id)}
      <a href="#/{p.id}" class="item" aria-current={page === p.id ? 'page' : undefined} onclick={onClose} data-testid="side-{p.id}">
        <Icon d={p.icon} />
        {p.label}
        <span class="count">{p.count()}</span>
      </a>
    {/each}
  </nav>

  <h2>Tools</h2>
  <nav class="items" aria-label="Tools">
    {#each groups as group (group)}
      {@const tools = TOOLS.filter((t) => t.group === group)}
      {@const open = opened.has(group) || hereGroup === group}
      <button
        type="button"
        class="item group {groupClass(group)}"
        aria-expanded={open}
        onclick={() => toggle(group)}
        data-testid="side-group-{group}"
      >
        <span class="dot"></span>
        {group}
        <span class="count">{tools.length}</span>
        <span class="chev"><Icon d={UI_ICONS.chevron} size={14} /></span>
      </button>
      {#if open}
        <div class="sub">
          {#each tools as tool (tool.id)}
            <a
              href="#/{tool.id}"
              class="item"
              aria-current={here === tool.id ? 'page' : undefined}
              onclick={onClose}
              data-testid="side-{tool.id}">{tool.name}</a
            >
          {/each}
        </div>
      {/if}
    {/each}
  </nav>

  <div class="foot">
    <p>Files stay on this Mac. They are held in memory only and are gone when you close this tab.</p>
    {#if confirming}
      <p class="ask">Forget every file and result in this tab? Your originals and downloads are not touched.</p>
      <div class="pair">
        <button type="button" onclick={() => { shelf.clear(); confirming = false; }} data-testid="clear-yes">Clear</button>
        <button type="button" class="quiet" onclick={() => (confirming = false)}>Cancel</button>
      </div>
    {:else}
      <button type="button" class="quiet" disabled={empty} onclick={() => (confirming = true)} data-testid="clear-all">Clear all files</button>
    {/if}
  </div>
</aside>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    height: 100%;
    overflow-y: auto;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 2px 6px;
    font-weight: 700;
    font-size: 17px;
    color: var(--text);
    text-decoration: none;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
  }
  .close {
    display: none;
    padding: 4px 6px;
  }
  h2 {
    margin: 6px 10px -4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .items {
    display: grid;
    gap: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: 9px;
    background: none;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    text-align: left;
    text-decoration: none;
  }
  .item:hover {
    background: var(--surface-2);
    filter: none;
  }
  .item[aria-current='page'] {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .dot {
    width: 9px;
    height: 9px;
    margin: 0 5px;
    border-radius: 3px;
    background: var(--gc);
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    font-weight: 400;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .chev {
    display: grid;
    color: var(--muted);
    transition: transform 150ms;
  }
  .group[aria-expanded='true'] .chev {
    transform: rotate(90deg);
  }
  .sub {
    display: grid;
    gap: 1px;
    padding: 0 0 6px 28px;
  }
  .sub .item {
    font-size: 13.5px;
    padding: 5px 10px;
  }
  .foot {
    display: grid;
    gap: 8px;
    margin: auto 0 0;
    padding: 10px;
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--muted);
  }
  .foot p {
    margin: 0;
  }
  .foot .ask {
    color: var(--text);
  }
  .foot button {
    font-size: 13px;
    padding: 5px 10px;
  }
  .pair {
    display: flex;
    gap: 6px;
  }
  @media (max-width: 820px) {
    .close {
      display: block;
    }
  }
</style>
