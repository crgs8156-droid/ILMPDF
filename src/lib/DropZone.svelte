<script lang="ts">
  type Props = { onFiles: (files: File[]) => void };
  let { onFiles }: Props = $props();

  let dragging = $state(false);
  let input: HTMLInputElement;

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    onFiles(Array.from(event.dataTransfer?.files ?? []));
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
  role="button"
  tabindex="0"
  aria-label="Drop PDF files here or press to choose files"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={handleDrop}
  onclick={() => input.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input.click()}
>
  <p class="title">Drop PDF files here</p>
  <p class="hint">or click to choose. Files stay on this Mac.</p>
  <input
    bind:this={input}
    type="file"
    accept=".pdf,application/pdf"
    multiple
    hidden
    data-testid="file-input"
    onchange={handlePick}
  />
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
  .hint {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
