<script lang="ts">
  // The ⌘K tool search box. It is the browser's own modal <dialog>, which
  // keeps keyboard focus inside it, closes on Esc and stops clicks reaching
  // the page behind. The text you type lives in memory only and is cleared
  // each time the box opens. Ranking lives in core/tool-search.ts.
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { TOOL_ICONS, UI_ICONS, groupClass } from './icons';
  import { searchTools } from '../core/tool-search';
  import type { Tool } from '../tools/registry';

  type Props = { tools: readonly Tool[]; onPick: (id: string) => void };
  let { tools, onPick }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLUListElement>();
  let query = $state('');
  let active = $state(0);
  // Where focus was before the box opened, to put it back on Esc.
  let returnTo: HTMLElement | null = null;

  // With nothing typed, every tool is listed in the usual order.
  const results = $derived(query.trim() ? searchTools(tools, query) : [...tools]);
  const activeId = $derived.by(() => {
    const tool = results[active];
    return tool ? `palette-opt-${tool.id}` : undefined;
  });

  /** Opens the box with an empty search. Does nothing if it is already open. */
  export async function show() {
    if (!dialog || dialog.open) return;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query = '';
    active = 0;
    dialog.showModal();
    await tick();
    input?.focus();
  }

  function close(restoreFocus: boolean) {
    if (!dialog?.open) return;
    dialog.close();
    if (restoreFocus) returnTo?.focus({ preventScroll: true });
    returnTo = null;
  }

  // Focus goes back first; opening the tool then moves it to the tool's heading.
  function pick(id: string) {
    close(true);
    onPick(id);
  }

  function onInput() {
    active = 0;
  }

  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const n = results.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      active = (active + 1) % n;
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      active = (active - 1 + n) % n;
    } else if (e.key === 'Home' && n && !query) {
      e.preventDefault();
      active = 0;
    } else if (e.key === 'End' && n && !query) {
      e.preventDefault();
      active = n - 1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tool = results[active];
      if (tool) pick(tool.id);
    }
  }

  // Esc: the browser fires 'cancel' and would close the box itself; we close
  // it so focus goes back to where it was.
  function onCancel(e: Event) {
    e.preventDefault();
    close(true);
  }

  // A click on the dim area around the box (the dialog element itself, not
  // its contents) closes it.
  function onDialogClick(e: MouseEvent) {
    if (e.target === dialog) close(true);
  }

  // Keep the highlighted tool in view while moving with the arrow keys.
  $effect(() => {
    const id = activeId;
    if (!id || !list) return;
    list.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'nearest' });
  });
</script>

<dialog bind:this={dialog} class="palette" aria-label="Search tools" oncancel={onCancel} onclick={onDialogClick} data-testid="palette">
  <div class="box">
    <div class="field">
      <Icon d={UI_ICONS.search} size={18} />
      <input
        bind:this={input}
        bind:value={query}
        oninput={onInput}
        onkeydown={onKey}
        type="text"
        role="combobox"
        aria-label="Search tools"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Search tools, or try “password” or “smaller”"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-testid="palette-input"
      />
      <kbd>esc</kbd>
    </div>

    <ul bind:this={list} id="palette-list" role="listbox" aria-label="Tools" data-testid="palette-list">
      {#each results as tool, i (tool.id)}
        <!-- Keyboard use goes through the search field (aria-activedescendant), so options are not tab stops. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="palette-opt-{tool.id}"
          role="option"
          aria-selected={i === active}
          class="opt {groupClass(tool.group)}"
          onclick={() => pick(tool.id)}
          onmousemove={() => (active = i)}
          data-testid="palette-opt-{tool.id}"
        >
          <span class="tile"><Icon d={TOOL_ICONS[tool.id] ?? UI_ICONS.doc} size={18} /></span>
          <span class="text">
            <strong>{tool.name}</strong>
            <span class="blurb">{tool.blurb}</span>
          </span>
          <span class="group">{tool.group}</span>
        </li>
      {/each}
    </ul>

    {#if results.length === 0}
      <p class="none" role="status" data-testid="palette-none">No tool matches “{query.trim()}”. Try a shorter word.</p>
    {/if}

    <p class="keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to choose · <kbd>return</kbd> to open · <kbd>esc</kbd> to close</p>
  </div>
</dialog>

<style>
  .palette {
    width: min(600px, calc(100vw - 24px));
    max-height: min(560px, calc(100vh - 24px));
    margin: 12vh auto auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .palette::backdrop {
    background: rgb(10 12 16 / 0.35);
  }
  .box {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 17px;
  }
  ul {
    margin: 0;
    padding: 6px;
    list-style: none;
    overflow-y: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 9px;
    cursor: pointer;
  }
  .opt[aria-selected='true'] {
    background: var(--accent-soft);
  }
  .opt .tile {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }
  .text {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .text strong {
    font-size: 14px;
  }
  .blurb {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .group {
    font-size: 11px;
    font-weight: 600;
    color: var(--gc, var(--muted));
  }
  .none {
    margin: 0;
    padding: 18px 16px;
    color: var(--muted);
  }
  .keys {
    margin: 0;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }
  kbd {
    display: inline-block;
    min-width: 1.6em;
    margin: 0 2px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-2);
    font: inherit;
    font-size: 11px;
    text-align: center;
  }
  @media (max-width: 560px) {
    .group,
    .keys {
      display: none;
    }
  }
</style>
