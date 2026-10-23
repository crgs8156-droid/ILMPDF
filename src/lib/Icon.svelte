<script lang="ts">
  // A stroked line icon from lib/icons.ts. It takes the text colour of
  // whatever it sits in, and is hidden from screen readers (the text next
  // to it says the same thing).
  type Props = { d: string; size?: number };
  let { d, size = 20 }: Props = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
  <path {d} />
</svg>

<style>
  svg {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
