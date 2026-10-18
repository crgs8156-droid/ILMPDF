<script lang="ts">
  // The "Also remove scripts" checkbox. Tools pass its value to cleanIf()
  // in core/clean.ts. Off by default, so files only change when asked.
  type Props = { checked: boolean };
  let { checked = $bindable() }: Props = $props();
</script>

<label class="check" title="Removes JavaScript, actions that run by themselves or open other programs, XFA forms and attached files">
  <input type="checkbox" bind:checked data-testid="also-clean" />
  Also remove scripts and attached files
</label>
