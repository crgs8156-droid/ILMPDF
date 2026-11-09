// A clock that ticks every 30 seconds while a page shows it, for "5 min ago".
export function useClock(): { readonly now: number } {
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  return {
    get now() {
      return now;
    },
  };
}
