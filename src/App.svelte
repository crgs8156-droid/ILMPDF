<script lang="ts">
  import { onMount, tick } from 'svelte';
  import SecurityBadge from './lib/SecurityBadge.svelte';
  import DropWheel from './lib/DropWheel.svelte';
  import { TOOLS } from './tools/registry';
  import { nav } from './core/nav.svelte';
  import { titleFor } from './core/router';

  // Where we are lives in the address hash (see core/router.ts), so Safari's
  // Back and Forward buttons, ⌘[ and swipe-back all work.
  onMount(() => nav.start(TOOLS.map((t) => t.id)));

  const current = $derived.by(() => {
    const route = nav.route;
    return route.kind === 'tool' ? TOOLS.find((t) => t.id === route.id) : undefined;
  });
  const groups = [...new Set(TOOLS.map((t) => t.group))];

  let heading = $state<HTMLElement>();
  // Remembered in memory only, to put you back where you were on the home page.
  let homeScroll = 0;
  let lastTool: string | null = null;

  $effect(() => {
    document.title = titleFor(nav.route, current?.name);
  });

  // When the page changes: a tool opens at the top with its heading focused
  // (so VoiceOver reads it); the home page returns to where you left it,
  // with the tool you just used focused.
  const pageKey = $derived(current ? `tool:${current.id}` : nav.route.kind);
  $effect(() => {
    const key = pageKey;
    void tick().then(() => {
      if (key === 'home') {
        scrollTo(0, homeScroll);
        if (lastTool) document.querySelector<HTMLElement>(`[data-testid="open-${lastTool}"]`)?.focus({ preventScroll: true });
      } else {
        scrollTo(0, 0);
        heading?.focus({ preventScroll: true });
      }
    });
  });

  function leaveHome(id: string) {
    homeScroll = scrollY;
    lastTool = id;
  }

  // Esc on a tool's file picker goes back to the home page. It does nothing
  // once a PDF is loaded, so a stray Esc can't throw away your work.
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (nav.route.kind === 'missing' || (nav.route.kind === 'tool' && !nav.route.file)) nav.up();
  }
</script>

<svelte:window onkeydown={onKey} />

<main>
  <header>
    <h1><a href="#/" class="home">ILMPDF</a></h1>
    <SecurityBadge />
  </header>

  {#if current && nav.route.kind === 'tool'}
    {@const ToolView = current.component}
    <section class="tool" data-testid="tool-{current.id}">
      <div class="title">
        <div class="crumbs">
          <button type="button" class="quiet back" data-testid="back" onclick={() => nav.up()}>
            ‹ {nav.route.file ? 'Back' : 'All tools'}
          </button>
          <nav aria-label="Breadcrumb" class="trail" data-testid="breadcrumb">
            <a href="#/">All tools</a>
            <span aria-hidden="true">›</span>
            <span>{current.group}</span>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{current.name}</span>
          </nav>
        </div>
        <h2 bind:this={heading} tabindex="-1">{current.name}</h2>
        <p class="muted">{current.blurb}</p>
      </div>
      {#key current.id}<ToolView />{/key}
    </section>
  {:else if nav.route.kind === 'missing'}
    <section class="tool" data-testid="not-found">
      <h2 bind:this={heading} tabindex="-1">Tool not found</h2>
      <p class="muted">There is no tool at this address. It may have been renamed.</p>
      <p><a href="#/" class="back" data-testid="not-found-home">‹ Back to all tools</a></p>
    </section>
  {:else}
    <p class="lead">Private PDF tools. Every file stays on this Mac; the network is blocked.</p>
    <p class="tip" data-testid="wheel-tip">Tip: drag a PDF onto this page and drop it on a tool in the wheel that appears.</p>
    {#each groups as group (group)}
      <h2 class="group">{group}</h2>
      <ul class="tools">
        {#each TOOLS.filter((t) => t.group === group) as tool (tool.id)}
          <li>
            <a href="#/{tool.id}" data-testid="open-{tool.id}" onclick={() => leaveHome(tool.id)}>
              <strong>{tool.name}</strong>
              <span>{tool.blurb}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</main>

<!-- Only on the home page: each tool has its own drop area. -->
<DropWheel enabled={nav.route.kind === 'home'} />

<style>
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: grid;
    gap: 16px;
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
  .home {
    color: inherit;
    text-decoration: none;
  }
  .lead {
    margin: 0;
    color: var(--muted);
  }
  .tip {
    margin: -8px 0 0;
    color: var(--muted);
    font-size: 13px;
  }
  .group {
    margin: 8px 0 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .tools {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
  }
  .tools a {
    display: grid;
    gap: 4px;
    height: 100%;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    text-decoration: none;
  }
  .tools a:hover,
  .tools a:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .tools span {
    color: var(--muted);
    font-size: 13px;
  }
  .tool {
    display: grid;
    gap: 14px;
  }
  .title h2,
  .tool > h2 {
    margin: 10px 0 0;
    font-size: 22px;
  }
  h2[tabindex='-1']:focus {
    outline: none;
  }
  .title p {
    margin: 2px 0 0;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .back {
    font-weight: 600;
  }
  a.back {
    color: var(--accent);
    text-decoration: none;
  }
  .trail {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--muted);
  }
  .trail a {
    color: var(--accent);
    text-decoration: none;
  }
</style>
