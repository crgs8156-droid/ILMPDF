<script lang="ts">
  import SecurityBadge from './lib/SecurityBadge.svelte';
  import { TOOLS, type Tool } from './tools/registry';

  // The current tool lives in the URL hash so Back/Forward work.
  // Hash changes never leave the page or touch the network.
  let current = $state<Tool | null>(fromHash());

  function fromHash(): Tool | null {
    const id = location.hash.replace(/^#\/?/, '');
    return TOOLS.find((t) => t.id === id) ?? null;
  }

  $effect(() => {
    const onHash = () => (current = fromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });

  const groups = [...new Set(TOOLS.map((t) => t.group))];
</script>

<main>
  <header>
    <h1><a href="#/" class="home">ILMPDF</a></h1>
    <SecurityBadge />
  </header>

  {#if current}
    {@const ToolView = current.component}
    <section class="tool" data-testid="tool-{current.id}">
      <div class="title">
        <a href="#/" class="back" data-testid="back">← All tools</a>
        <h2>{current.name}</h2>
        <p class="muted">{current.blurb}</p>
      </div>
      {#key current.id}<ToolView />{/key}
    </section>
  {:else}
    <p class="lead">Private PDF tools. Every file stays on this Mac; the network is blocked.</p>
    {#each groups as group (group)}
      <h2 class="group">{group}</h2>
      <ul class="tools">
        {#each TOOLS.filter((t) => t.group === group) as tool (tool.id)}
          <li>
            <a href="#/{tool.id}" data-testid="open-{tool.id}">
              <strong>{tool.name}</strong>
              <span>{tool.blurb}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</main>

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
  .title h2 {
    margin: 4px 0 0;
    font-size: 22px;
  }
  .title p {
    margin: 2px 0 0;
  }
  .back {
    color: var(--accent);
    text-decoration: none;
    font-size: 14px;
  }
</style>
