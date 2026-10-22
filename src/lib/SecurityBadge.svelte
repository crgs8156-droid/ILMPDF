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
    gap: 6px;
    flex-wrap: wrap;
    font-size: 12px;
    font-weight: 600;
  }
  span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-2);
  }
  span::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .good {
    color: var(--good);
    background: color-mix(in srgb, var(--good) 12%, transparent);
  }
  .bad {
    color: var(--bad);
    background: color-mix(in srgb, var(--bad) 14%, transparent);
  }
</style>
