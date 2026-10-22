// Pure helpers for the Bookmarks tool: editing the flat bookmark list
// (each move keeps a bookmark's sub-bookmarks with it) and planning a split
// by bookmarks. No PDF parsing happens here.
import type { Bookmark } from '../engines/mupdf-bookmarks';
import { safeFileName } from './validate';

/** Index just past bookmark i's sub-bookmarks. */
export function subtreeEnd(list: Bookmark[], i: number): number {
  const level = list[i]!.level;
  let j = i + 1;
  while (j < list.length && list[j]!.level > level) j++;
  return j;
}

/** Previous bookmark at the same level under the same parent, or -1. */
function prevSibling(list: Bookmark[], i: number): number {
  const level = list[i]!.level;
  for (let k = i - 1; k >= 0; k--) {
    if (list[k]!.level === level) return k;
    if (list[k]!.level < level) return -1;
  }
  return -1;
}

export function canMoveUp(list: Bookmark[], i: number): boolean {
  return prevSibling(list, i) >= 0;
}

export function canMoveDown(list: Bookmark[], i: number): boolean {
  const next = subtreeEnd(list, i);
  return next < list.length && list[next]!.level === list[i]!.level;
}

/** Can sit one level deeper: only under a bookmark above at the same level. */
export function canIndent(list: Bookmark[], i: number): boolean {
  return prevSibling(list, i) >= 0;
}

export function canOutdent(list: Bookmark[], i: number): boolean {
  return list[i]!.level > 0;
}

/** Swaps bookmark i (with its sub-bookmarks) and the sibling above it. */
export function moveUp<T extends Bookmark>(list: T[], i: number): T[] {
  const k = prevSibling(list, i);
  if (k < 0) return list;
  const end = subtreeEnd(list, i);
  return [...list.slice(0, k), ...list.slice(i, end), ...list.slice(k, i), ...list.slice(end)];
}

export function moveDown<T extends Bookmark>(list: T[], i: number): T[] {
  if (!canMoveDown(list, i)) return list;
  return moveUp(list, subtreeEnd(list, i));
}

/** Shifts bookmark i and its sub-bookmarks one level deeper or shallower. */
export function shift<T extends Bookmark>(list: T[], i: number, by: 1 | -1): T[] {
  if (by === 1 ? !canIndent(list, i) : !canOutdent(list, i)) return list;
  const end = subtreeEnd(list, i);
  return list.map((b, j) => (j >= i && j < end ? { ...b, level: b.level + by } : b));
}

/** Removes bookmark i; its sub-bookmarks move up one level into its place. */
export function remove<T extends Bookmark>(list: T[], i: number): T[] {
  const end = subtreeEnd(list, i);
  return list.flatMap((b, j) => (j === i ? [] : j > i && j < end ? [{ ...b, level: b.level - 1 }] : [b]));
}

export type SplitPart = { title: string; pages: number[] };

export const MAX_SPLIT_PARTS = 500;

/**
 * Plans a split: each bookmark at `maxLevel` or above (0 = top level only)
 * starts a new part that runs until the next one starts. Pages before the
 * first bookmark become a "Start" part. Bookmarks are taken in page order;
 * when several start on the same page, the first one names the part.
 */
export function planSplit(list: Bookmark[], pages: number, maxLevel: number): SplitPart[] {
  const starts = list
    .filter((b): b is Bookmark & { page: number } => b.page !== null && b.level <= maxLevel && b.page < pages)
    .map((b, order) => ({ ...b, order }))
    .sort((a, b) => a.page - b.page || a.order - b.order)
    .filter((b, i, all) => i === 0 || all[i - 1]!.page !== b.page);
  if (starts.length === 0) return [];
  const parts: SplitPart[] = [];
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
  if (starts[0]!.page > 0) parts.push({ title: 'Start', pages: range(0, starts[0]!.page) });
  starts.forEach((b, i) => {
    parts.push({ title: b.title || 'Untitled', pages: range(b.page, starts[i + 1]?.page ?? pages) });
  });
  return parts;
}

/** File name for part n (1-based), such as "report-02-Chapter 1.pdf". */
export function partFileName(original: string, n: number, total: number, title: string): string {
  const num = String(n).padStart(String(total).length, '0');
  // Reuse the file-name cleaner on the title, without its extension.
  const clean = safeFileName(title, '', '').slice(0, 60).trim();
  return safeFileName(original, `-${num}-${clean}`);
}
