// Plain rules behind the file shelf (core/shelf.svelte.ts), kept apart so
// they can be unit-tested without a browser.

/** How much the shelf may hold. Oldest entries go first when it is full. */
export const SHELF_LIMITS = {
  files: { count: 20, bytes: 1024 * 1024 * 1024 }, // 1 GB of added PDFs
  saved: { count: 30, bytes: 1024 * 1024 * 1024 }, // 1 GB of results
  recent: { count: 30 },
} as const;

/**
 * Keeps the newest entries (the list is newest first) that fit in `count`
 * entries and `bytes` in total. An entry bigger than `bytes` on its own is
 * dropped, so one huge file can't push everything else out.
 */
export function trimNewestFirst<T extends { size: number }>(list: T[], count: number, bytes: number): T[] {
  const kept: T[] = [];
  let total = 0;
  for (const item of list) {
    if (kept.length >= count) break;
    if (total + item.size > bytes) continue;
    kept.push(item);
    total += item.size;
  }
  return kept;
}

/** "just now", "5 min ago", "2 h ago". Times are only ever from this session. */
export function timeAgo(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** True when two byte arrays hold exactly the same bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
