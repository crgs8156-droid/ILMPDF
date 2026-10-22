<script lang="ts">
  import Icon from './Icon.svelte';
  import { UI_ICONS } from './icons';
  type Props = { kind?: 'error' | 'ok' | 'info'; messages: string[] };
  let { kind = 'error', messages }: Props = $props();
</script>

{#if messages.length > 0}
  <div class="notice {kind}" role={kind === 'error' ? 'alert' : 'status'} data-testid="notice-{kind}">
    <span class="mark"><Icon d={kind === 'ok' ? UI_ICONS.ok : kind === 'info' ? UI_ICONS.info : UI_ICONS.alert} size={18} /></span>
    <div class="text">{#each messages as m, i (i)}<p>{m}</p>{/each}</div>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 14px;
    color: var(--text);
    --tone: var(--accent);
    background: color-mix(in srgb, var(--tone) 11%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--tone) 35%, transparent);
  }
  .mark {
    display: grid;
    margin-top: 1px;
    color: var(--tone);
  }
  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .notice p {
    margin: 0;
  }
  .error {
    --tone: var(--bad);
  }
  .ok {
    --tone: var(--good);
  }
</style>
