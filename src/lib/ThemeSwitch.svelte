<script lang="ts">
  // Auto / Light / Dark. Auto follows macOS. The choice is kept in memory
  // only (browser storage is banned), so a reload goes back to Auto.
  type Theme = 'auto' | 'light' | 'dark';
  const OPTIONS: { id: Theme; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  let theme = $state<Theme>('auto');

  $effect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  });
</script>

<div class="switch" role="group" aria-label="Appearance" data-testid="theme-switch">
  {#each OPTIONS as o (o.id)}
    <button type="button" aria-pressed={theme === o.id} onclick={() => (theme = o.id)} data-testid="theme-{o.id}">
      {o.label}
    </button>
  {/each}
</div>

<style>
  .switch {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  button {
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border: 0;
    border-radius: 0;
    background: var(--surface);
    color: var(--muted);
  }
  button:not(:disabled):hover {
    filter: none;
    color: var(--text);
  }
  button[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
</style>
