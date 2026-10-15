// Parses page selections typed by the user, e.g. "1-3, 5, 8-".
// Pages are 1-based in the UI and 0-based everywhere in code.

export type PageSpecResult = { ok: true; groups: number[][] } | { ok: false; error: string };

/** Each comma-separated part becomes one group (used by split). */
export function parsePageGroups(spec: string, pageCount: number): PageSpecResult {
  const parts = spec.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: 'Enter at least one page or range' };
  if (parts.length > 1000) return { ok: false, error: 'Too many ranges' };

  const groups: number[][] = [];
  for (const part of parts) {
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `Not a page or range: "${part}"` };
    const start = m[1] ? Number(m[1]) : 1;
    const end = m[2] ? (m[3] ? Number(m[3]) : pageCount) : start;
    if (start < 1 || end < 1) return { ok: false, error: 'Pages start at 1' };
    if (start > pageCount || end > pageCount) {
      return { ok: false, error: `This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}` };
    }
    if (start > end) return { ok: false, error: `Range goes backwards: "${part}"` };
    groups.push(Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
  }
  return { ok: true, groups };
}

/** Splits into consecutive chunks of `size` pages. */
export function everyNPages(pageCount: number, size: number): number[][] {
  const n = Math.max(1, Math.floor(size));
  const groups: number[][] = [];
  for (let s = 0; s < pageCount; s += n) {
    groups.push(Array.from({ length: Math.min(n, pageCount - s) }, (_, i) => s + i));
  }
  return groups;
}
