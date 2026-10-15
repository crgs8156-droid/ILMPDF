<script lang="ts">
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
  <p class="title">{title}</p>
  {#if !compact}<p class="hint">{hint}</p>{/if}
  <input bind:this={input} type="file" {accept} {multiple} hidden data-testid="file-input" onchange={handlePick} />
</div>

<style>
  .zone {
    border: 2px dashed var(--border);
    border-radius: 12px;
    padding: 40px 16px;
    text-align: center;
    background: var(--surface);
    cursor: pointer;
  }
  .zone.compact {
    padding: 12px 16px;
  }
  .zone.dragging,
  .zone:focus-visible {
    border-color: var(--accent);
    outline: none;
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
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
