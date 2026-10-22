// The text codes for headers, footers and Bates numbers. No PDF library here,
// so the tool's live preview can use the same code on the page itself while
// the PDF work stays in the worker (src/engines/header-footer.ts).

/** The six spots on a page where text can go. */
export const SLOTS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type Slot = (typeof SLOTS)[number];

export type BatesOptions = { prefix: string; suffix: string; start: number; digits: number };

/** Values for one page, used to fill in the text codes. */
export type PageValues = { page: number; total: number; file: string; date: string; bates: string };

export const MAX_TEXT = 200;
export const MAX_AFFIX = 40;

/** Pads the number with zeros: prefix "ABC", 123 and 6 digits give "ABC000123". */
export function batesLabel(b: BatesOptions, n: number): string {
  const digits = Math.trunc(clamp(b.digits, 1, 12));
  return `${cleanText(b.prefix, MAX_AFFIX)}${String(Math.trunc(n)).padStart(digits, '0')}${cleanText(b.suffix, MAX_AFFIX)}`;
}

/**
 * Replaces {page}, {total}, {date}, {file} and {bates} in a template. Codes
 * are matched without regard to case; anything else in braces is left as typed.
 */
export function fillTemplate(template: string, v: PageValues): string {
  const values: Record<string, string> = {
    page: String(v.page),
    total: String(v.total),
    date: v.date,
    file: v.file,
    bates: v.bates,
  };
  return cleanText(template, MAX_TEXT).replace(/\{(\w+)\}/g, (code, key: string) => values[key.toLowerCase()] ?? code);
}

/** Today's date on this Mac, as YYYY-MM-DD. */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Single line, trimmed and length-capped: line breaks and control characters become spaces. */
export function cleanText(text: string, max: number): string {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
