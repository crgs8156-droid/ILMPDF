<script lang="ts">
  // "Open in…": opens a file from Your files in any one-PDF tool.
  import { shelf } from '../core/shelf.svelte';
  import { TOOLS } from '../tools/registry';
  import { ONE_PDF_TOOLS } from '../tools/one-pdf-tools';

  type Props = { fileId: number; name: string };
  let { fileId, name }: Props = $props();
  const tools = TOOLS.filter((t) => ONE_PDF_TOOLS.includes(t.id));

  function pick(e: Event) {
    const el = e.currentTarget as HTMLSelectElement;
    const tool = el.value;
    el.value = '';
    if (tool) shelf.openIn(fileId, tool);
  }
</script>

<select aria-label="Open {name} in a tool" onchange={pick} data-testid="open-in">
  <option value="">Open in…</option>
  {#each tools as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
</select>
