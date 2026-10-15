<script lang="ts">
  import { onMount } from 'svelte';
  import { readSecurityStatus, type SecurityStatus } from '../core/security-status';

  let status = $state<SecurityStatus | null>(null);

  onMount(async () => {
    status = await readSecurityStatus();
  });
</script>

<section class="badge" aria-label="Security status" data-testid="security-status">
  {#if status}
    <span class:good={status.networkBlocked} class:bad={!status.networkBlocked} data-testid="network-status">
      {status.networkBlocked ? 'Network blocked' : 'Network NOT blocked'}
    </span>
    <span class:good={status.isolated} class:bad={!status.isolated} data-testid="isolation-status">
      {status.isolated ? 'Cross-origin isolated' : 'Not isolated'}
    </span>
  {:else}
    <span>Checking security…</span>
  {/if}
</section>

<style>
  .badge {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  span {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .good {
    color: var(--good);
    border-color: var(--good);
  }
  .bad {
    color: var(--bad);
    border-color: var(--bad);
  }
</style>
