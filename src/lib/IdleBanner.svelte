<script lang="ts">
  // The one-minute warning before auto-clear (core/idle.svelte.ts).
  import Icon from './Icon.svelte';
  import { UI_ICONS } from './icons';
  import { idle } from '../core/idle.svelte';
</script>

{#if idle.warning}
  <div class="banner" role="alert" data-testid="idle-warning">
    <Icon d={UI_ICONS.clock} size={18} />
    <p>No use for 14 minutes. Your files will be cleared from memory in 1 minute.</p>
    <button type="button" onclick={idle.keep} data-testid="idle-keep">Keep my files</button>
  </div>
{/if}

<style>
  .banner {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 14px;
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }
  p {
    flex: 1;
    margin: 0;
  }
  button {
    font-size: 13px;
    padding: 5px 12px;
    white-space: nowrap;
  }
</style>
