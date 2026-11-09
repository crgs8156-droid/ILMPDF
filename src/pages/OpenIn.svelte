<script lang="ts">
  // "Open in…": a menu of the one-PDF tools. Used for files on Your files and
  // Recent files (opened straight away) and for saved PDF results (which are
  // checked first, see continueWith in core/files.ts).
  import { TOOLS } from '../tools/registry';
  import { ONE_PDF_TOOLS } from '../tools/one-pdf-tools';

  type Props = {
    name: string;
    onPick: (tool: string) => void;
    /** A tool to leave out, such as the one already open. */
    exclude?: string | null;
    label?: string;
    testid?: string;
  };
  let { name, onPick, exclude = null, label = 'Open in…', testid = 'open-in' }: Props = $props();
  const tools = $derived(TOOLS.filter((t) => ONE_PDF_TOOLS.includes(t.id) && t.id !== exclude));

  function pick(e: Event) {
    const el = e.currentTarget as HTMLSelectElement;
    const tool = el.value;
    el.value = '';
    if (tool) onPick(tool);
  }
</script>

<select aria-label="Open {name} in a tool" onchange={pick} data-testid={testid}>
  <option value="">{label}</option>
  {#each tools as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
</select>
