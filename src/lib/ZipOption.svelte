<script lang="ts">
  // The "Save as one ZIP" checkbox for tools that make many files. Tools pass
  // its value to saveFiles() in core/save.ts. Ticked by default; the choice is
  // not remembered, because ILMPDF saves nothing to browser storage.
  type Props = { checked: boolean };
  let { checked = $bindable() }: Props = $props();
</script>

<label class="check" title="One download instead of many, so Safari doesn't ask to allow several downloads">
  <input type="checkbox" bind:checked data-testid="as-zip" />
  Save as one ZIP
</label>
