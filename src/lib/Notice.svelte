<script lang="ts">
  type Props = { kind?: 'error' | 'ok' | 'info'; messages: string[] };
  let { kind = 'error', messages }: Props = $props();
</script>

{#if messages.length > 0}
  <div class="notice {kind}" role={kind === 'error' ? 'alert' : 'status'} data-testid="notice-{kind}">
    {#each messages as m, i (i)}<p>{m}</p>{/each}
  </div>
{/if}

<style>
  .notice {
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 14px;
    border: 1px solid var(--border);
  }
  .notice p {
    margin: 0;
  }
  .error {
    border-color: var(--bad);
    color: var(--bad);
  }
  .ok {
    border-color: var(--good);
    color: var(--good);
  }
</style>
