<script lang="ts">
  import Icon from './Icon.svelte';
  import { UI_ICONS } from './icons';
  type Props = {
    onFiles: (files: File[]) => void;
    accept?: string;
    multiple?: boolean;
    title?: string;
    hint?: string;
    compact?: boolean;
  };
  let {
    onFiles,
    accept = '.pdf,application/pdf',
    multiple = true,
    title = 'Drop PDF files here',
    hint = 'or click to choose. Files stay on this Mac.',
    compact = false,
  }: Props = $props();

  let dragging = $state(false);
  let input: HTMLInputElement;

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    onFiles(multiple ? files : files.slice(0, 1));
  }

  function handlePick(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    onFiles(Array.from(el.files ?? []));
    el.value = '';
  }
</script>

<div
  class="zone"
  class:dragging
  class:compact
  role="button"
  tabindex="0"
  aria-label={`${title}. Press to choose files.`}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={handleDrop}
  onclick={() => input.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input.click()}
>
  {#if !compact}<span class="art"><Icon d={UI_ICONS.drop} size={44} /></span>{/if}
  <p class="title">{title}</p>
  {#if !compact}<p class="hint">{hint}</p>{/if}
  <input bind:this={input} type="file" {accept} {multiple} hidden data-testid="file-input" onchange={handlePick} />
</div>

<style>
  .zone {
    display: grid;
    justify-items: center;
    gap: 6px;
    border: 2px dashed color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 16px;
    padding: 44px 16px;
    text-align: center;
    background: linear-gradient(180deg, var(--accent-soft), var(--surface) 70%);
    cursor: pointer;
    transition: border-color 120ms;
  }
  .zone.compact {
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--surface);
  }
  .zone:hover,
  .zone.dragging,
  .zone:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .art {
    display: grid;
    color: var(--accent);
  }
  .title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .compact .title {
    font-size: 15px;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
