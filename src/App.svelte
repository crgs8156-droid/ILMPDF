<script lang="ts">
  import { onMount, tick } from 'svelte';
  import SecurityBadge from './lib/SecurityBadge.svelte';
  import Sidebar from './lib/Sidebar.svelte';
  import ThemeSwitch from './lib/ThemeSwitch.svelte';
  import Icon from './lib/Icon.svelte';
  import { TOOL_ICONS, UI_ICONS, groupClass } from './lib/icons';
  import { TOOLS } from './tools/registry';
  import { nav } from './core/nav.svelte';
  import { PAGES, titleFor } from './core/router';
  import { shelf } from './core/shelf.svelte';
  import FilesPage from './pages/FilesPage.svelte';
  import RecentList from './pages/RecentList.svelte';

  // Where we are lives in the address hash (see core/router.ts), so Safari's
  // Back and Forward buttons, ⌘[ and swipe-back all work.
  onMount(() => nav.start(TOOLS.map((t) => t.id)));

  const current = $derived.by(() => {
    const route = nav.route;
    return route.kind === 'tool' ? TOOLS.find((t) => t.id === route.id) : undefined;
  });
  const groups = [...new Set(TOOLS.map((t) => t.group))];

  // Dashboard filter chips: 'All' or one group. Memory only.
  let filter = $state('All');
  const shownGroups = $derived(filter === 'All' ? groups : [filter]);
  // The sidebar is a drawer on narrow windows; this opens and closes it.
  let menuOpen = $state(false);

  let heading = $state<HTMLElement>();
  // Remembered in memory only, to put you back where you were on the dashboard.
  let homeScroll = 0;
  let lastTool: string | null = null;

  $effect(() => {
    document.title = titleFor(nav.route, current?.name);
  });

  // When the page changes: a tool opens at the top with its heading focused
  // (so VoiceOver reads it); the dashboard returns to where you left it,
  // with the tool you just used focused.
  const page = $derived(nav.route.kind === 'page' ? nav.route.id : null);
  const pageKey = $derived(current ? `tool:${current.id}` : page ? `page:${page}` : nav.route.kind);
  $effect(() => {
    const key = pageKey;
    menuOpen = false;
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

  function showGroup(group: string) {
    filter = group;
    homeScroll = 0;
    nav.go({ kind: 'home' });
  }

  // Esc closes the menu drawer if it is open. Otherwise, on a tool's file
  // picker it goes back to the dashboard. It does nothing once a PDF is
  // loaded, so a stray Esc can't throw away your work.
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (nav.route.kind === 'missing' || (nav.route.kind === 'tool' && !nav.route.file)) nav.up();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="shell" class:menu-open={menuOpen}>
  <div class="side-wrap">
    <Sidebar here={current?.id ?? null} onDashboard={nav.route.kind === 'home'} {page} onClose={() => (menuOpen = false)} />
  </div>
  <button type="button" class="scrim" aria-label="Close menu" tabindex="-1" onclick={() => (menuOpen = false)}></button>

  <div class="main">
    <header class="bar">
      <button type="button" class="quiet menu" aria-label="Open menu" aria-expanded={menuOpen} onclick={() => (menuOpen = true)} data-testid="menu">
        <Icon d={UI_ICONS.menu} size={18} />
      </button>
      <span class="bar-title">{current ? current.name : page ? PAGES[page] : nav.route.kind === 'home' ? 'Dashboard' : 'Not found'}</span>
      <div class="bar-right">
        <SecurityBadge />
        <ThemeSwitch />
      </div>
    </header>

    <main class="page">
      {#if current && nav.route.kind === 'tool'}
        {@const ToolView = current.component}
        <section class="tool" data-testid="tool-{current.id}">
          <div class="crumbs">
            <button type="button" class="quiet back" data-testid="back" onclick={() => nav.up()}>
              <Icon d={UI_ICONS.back} size={16} />
              {nav.route.file ? 'Back' : 'Dashboard'}
            </button>
            <nav aria-label="Breadcrumb" class="trail" data-testid="breadcrumb">
              <a href="#/">Dashboard</a>
              <span aria-hidden="true">›</span>
              <button type="button" class="link" onclick={() => showGroup(current.group)}>{current.group}</button>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{current.name}</span>
            </nav>
          </div>
          <div class="toolhead {groupClass(current.group)}">
            <span class="tile big"><Icon d={TOOL_ICONS[current.id] ?? UI_ICONS.doc} size={30} /></span>
            <div>
              <h1 bind:this={heading} tabindex="-1">{current.name}</h1>
              <p>{current.blurb}</p>
            </div>
          </div>
          {#key current.id}<ToolView />{/key}
        </section>
      {:else if page}
        {#key page}<FilesPage {page} bind:heading />{/key}
      {:else if nav.route.kind === 'missing'}
        <section class="tool" data-testid="not-found">
          <h1 bind:this={heading} tabindex="-1">Tool not found</h1>
          <p class="muted">There is no tool at this address. It may have been renamed.</p>
          <p><a href="#/" class="home-link" data-testid="not-found-home">‹ Back to the dashboard</a></p>
        </section>
      {:else}
        <section class="hero">
          <h1>Private PDF tools</h1>
          <p>{TOOLS.length} tools that work entirely on this Mac. Files are never uploaded, and the network is switched off for this page.</p>
        </section>
        {#if shelf.recent.length > 0}
          <div class="section-h">
            <h2>Recent files</h2>
            <a href="#/recent" data-testid="see-recent">See all</a>
          </div>
          <RecentList limit={3} />
          <h2 class="section-h">All tools</h2>
        {/if}
        <div class="chips" role="group" aria-label="Show tools from">
          {#each ['All', ...groups] as g (g)}
            <button type="button" class="quiet" aria-pressed={filter === g} onclick={() => (filter = g)} data-testid="filter-{g}">{g}</button>
          {/each}
        </div>
        {#each shownGroups as group (group)}
          <h2 class="group-h {groupClass(group)}"><span></span>{group}</h2>
          <ul class="grid">
            {#each TOOLS.filter((t) => t.group === group) as tool (tool.id)}
              <li>
                <a href="#/{tool.id}" class="card {groupClass(tool.group)}" data-testid="open-{tool.id}" onclick={() => leaveHome(tool.id)}>
                  <span class="tile"><Icon d={TOOL_ICONS[tool.id] ?? UI_ICONS.doc} size={22} /></span>
                  <strong>{tool.name}</strong>
                  <span class="blurb">{tool.blurb}</span>
                </a>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </main>

    <footer class="foot">ILMPDF runs offline: nothing you open here is uploaded or kept.</footer>
  </div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 256px minmax(0, 1fr);
    min-height: 100vh;
  }
  .side-wrap {
    position: sticky;
    top: 0;
    height: 100vh;
  }
  .scrim {
    display: none;
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 24px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
  }
  .bar-title {
    font-weight: 600;
    font-size: 15px;
  }
  .bar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .menu {
    display: none;
    padding: 5px 7px;
  }
  .page {
    width: 100%;
    max-width: 1040px;
    margin: 0 auto;
    padding: 28px 24px 48px;
    display: grid;
    gap: 20px;
    align-content: start;
  }
  .foot {
    margin-top: auto;
    padding: 14px 24px;
    border-top: 1px solid var(--border);
    text-align: center;
    font-size: 12px;
    color: var(--muted);
  }

  /* Dashboard */
  .hero h1 {
    margin: 0;
    font-size: 30px;
    line-height: 1.15;
    letter-spacing: -0.015em;
  }
  .hero p {
    margin: 6px 0 0;
    max-width: 62ch;
    color: var(--muted);
  }
  .section-h {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin: 4px 0 -8px;
    font-size: 17px;
  }
  .section-h h2 {
    margin: 0;
    font-size: 17px;
  }
  .section-h a {
    font-size: 13px;
    color: var(--accent);
    text-decoration: none;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chips button {
    font-size: 13px;
    padding: 5px 12px;
    border-radius: 999px;
  }
  .chips button[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .group-h {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 -8px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .group-h span {
    width: 8px;
    height: 8px;
    border-radius: 3px;
    background: var(--gc);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }
  .card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    align-content: start;
    gap: 2px 12px;
    height: 100%;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    text-decoration: none;
    transition:
      transform 140ms,
      box-shadow 140ms,
      border-color 140ms;
  }
  .card:hover,
  .card:focus-visible {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
    border-color: color-mix(in srgb, var(--gc) 45%, var(--border));
  }
  .card .tile {
    grid-row: 1 / span 2;
    align-self: start;
  }
  .card strong {
    font-size: 15px;
    line-height: 1.3;
  }
  .blurb {
    font-size: 13px;
    line-height: 1.4;
    color: var(--muted);
  }

  /* Tool page */
  .tool {
    display: grid;
    gap: 16px;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding-left: 8px;
    font-weight: 600;
  }
  .trail {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--muted);
  }
  .trail a,
  .link,
  .home-link {
    color: var(--accent);
    text-decoration: none;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    font-size: inherit;
    font-weight: 400;
  }
  .toolhead {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .tile.big {
    width: 56px;
    height: 56px;
    border-radius: 14px;
  }
  .toolhead h1,
  .tool > h1 {
    margin: 0;
    font-size: 26px;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }
  .toolhead p {
    margin: 2px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
  h1[tabindex='-1']:focus {
    outline: none;
  }

  /* Narrow windows: the sidebar becomes a drawer behind the ☰ button. */
  @media (max-width: 820px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }
    .side-wrap {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(300px, 86vw);
      transform: translateX(-100%);
      visibility: hidden;
      transition:
        transform 200ms ease,
        visibility 200ms;
    }
    .menu-open .side-wrap {
      transform: none;
      visibility: visible;
      box-shadow: 0 0 40px rgb(0 0 0 / 0.3);
    }
    .menu-open .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 25;
      border: 0;
      border-radius: 0;
      background: rgb(0 0 0 / 0.35);
    }
    .menu {
      display: block;
    }
    .bar,
    .page {
      padding-left: 16px;
      padding-right: 16px;
    }
  }
  @media (max-width: 560px) {
    .hero h1 {
      font-size: 24px;
    }
  }
</style>
