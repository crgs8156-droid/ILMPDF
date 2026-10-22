// Word-by-word comparison of two documents' text, written in-house so no
// diff library is needed. It uses Myers' algorithm ("An O(ND) Difference
// Algorithm", 1986), the same idea behind `git diff`: it finds the fewest
// words to remove and add to turn the older text into the newer one.
//
// Runs inside the MuPDF worker, right after the text is extracted, so a long
// comparison never freezes the page. Pure code: no DOM, no network.

/** Each document may have at most this many words (about 600 dense pages). */
export const MAX_COMPARE_WORDS = 300_000;
/**
 * Stop after this many word changes. Myers keeps one small array per change
 * step, so memory grows with the square of this number (3,000 is about
 * 36 MB at worst). Two files this different are better compared visually.
 */
export const MAX_DIFF_EDITS = 3_000;

export type ChunkKind = 'same' | 'removed' | 'added';
/** A run of words of one kind, in reading order. */
export type Chunk = { kind: ChunkKind; words: string[] };
/**
 * One place where the text changed. pageA / pageB are 1-based page numbers
 * in the older and newer file where the change starts.
 */
export type Change = { pageA: number; pageB: number; removed: string[]; added: string[] };
export type TextDiff = {
  chunks: Chunk[];
  changes: Change[];
  wordsA: number;
  wordsB: number;
  removed: number;
  added: number;
  /** True when the files differ in more than MAX_DIFF_EDITS words; chunks and changes are then empty. */
  tooDifferent: boolean;
};

type Word = { word: string; page: number };

/**
 * Splits page texts into words. NFKC turns ligatures and other look-alike
 * forms (such as "ﬁ" into "fi") into plain letters, so two PDFs made by
 * different apps still compare equal when they read the same.
 */
export function toWords(pages: string[]): Word[] {
  const out: Word[] = [];
  pages.forEach((text, i) => {
    for (const word of text.normalize('NFKC').split(/\s+/)) {
      if (word) out.push({ word, page: i + 1 });
    }
  });
  return out;
}

const enum Op {
  Same,
  Removed,
  Added,
}

/**
 * Myers' shortest edit script between two lists of word ids. Returns the
 * operations in order, or null when more than maxEdits changes are needed.
 */
function myers(a: Int32Array, b: Int32Array, maxEdits: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  // v[offset + k] = furthest x reached on diagonal k (where k = x - y).
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v for diagonals -d..d after step d, to walk back later.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxEdits); d++) {
    for (let k = -d; k <= d; k += 2) {
      // Move down (add a word from b) or right (remove a word from a),
      // whichever reaches further, then follow matching words diagonally.
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) found = d;
    }
    trace.push(v.slice(offset - d, offset + d + 1));
    if (found >= 0) break;
  }
  if (found < 0) return null;

  // Walk back from the end to the start, collecting operations in reverse.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]!; // diagonals -(d-1)..(d-1), stored from index 0
    const at = (k: number) => prev[k + d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(Op.Same);
      x--;
      y--;
    }
    ops.push(down ? Op.Added : Op.Removed);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push(Op.Same);
    x--;
    y--;
  }
  return ops.reverse();
}

/** Compares the page texts of an older (a) and newer (b) document. */
export function diffWords(pagesA: string[], pagesB: string[], maxEdits = MAX_DIFF_EDITS): TextDiff {
  const a = toWords(pagesA);
  const b = toWords(pagesB);
  const base = { wordsA: a.length, wordsB: b.length };
  if (a.length > MAX_COMPARE_WORDS || b.length > MAX_COMPARE_WORDS) {
    throw new RangeError(`Each file can have at most ${MAX_COMPARE_WORDS.toLocaleString('en-GB')} words to compare.`);
  }

  // Give each distinct word a number, so the inner loop compares integers.
  const ids = new Map<string, number>();
  const idOf = (w: Word) => {
    let id = ids.get(w.word);
    if (id === undefined) ids.set(w.word, (id = ids.size));
    return id;
  };
  const idsA = Int32Array.from(a, idOf);
  const idsB = Int32Array.from(b, idOf);

  // Matching words at the start and end need no search: trimming them first
  // keeps the common case (a few edits in a long document) fast.
  let start = 0;
  while (start < a.length && start < b.length && idsA[start] === idsB[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && idsA[endA - 1] === idsB[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = myers(idsA.subarray(start, endA), idsB.subarray(start, endB), maxEdits);
  if (!middle) return { ...base, chunks: [], changes: [], removed: 0, added: 0, tooDifferent: true };
  const ops = [...new Array<Op>(start).fill(Op.Same), ...middle, ...new Array<Op>(a.length - endA).fill(Op.Same)];

  const chunks: Chunk[] = [];
  const changes: Change[] = [];
  let i = 0;
  let j = 0;
  let removed = 0;
  let added = 0;
  let change: Change | null = null;
  // The page where a change sits, even when it is at the very end of a file.
  const pageAt = (list: Word[], index: number) => list[Math.min(index, list.length - 1)]?.page ?? 1;
  for (const op of ops) {
    const kind: ChunkKind = op === Op.Same ? 'same' : op === Op.Removed ? 'removed' : 'added';
    const word = op === Op.Added ? b[j]!.word : a[i]!.word;
    const last = chunks[chunks.length - 1];
    if (last?.kind === kind) last.words.push(word);
    else chunks.push({ kind, words: [word] });

    if (op === Op.Same) {
      change = null;
      i++;
      j++;
      continue;
    }
    if (!change) {
      change = { pageA: pageAt(a, i), pageB: pageAt(b, j), removed: [], added: [] };
      changes.push(change);
    }
    if (op === Op.Removed) {
      change.removed.push(word);
      removed++;
      i++;
    } else {
      change.added.push(word);
      added++;
      j++;
    }
  }
  return { ...base, chunks, changes, removed, added, tooDifferent: false };
}

/** One change for display, with a few unchanged words on each side. */
export type ChangeView = { change: Change; before: string[]; parts: Chunk[]; after: string[] };

/**
 * Groups the chunks into changes and keeps up to `keep` unchanged words on
 * each side of every change, so the reader sees where it sits in the text.
 */
export function changeViews(diff: TextDiff, keep = 8): ChangeView[] {
  const views: ChangeView[] = [];
  const { chunks } = diff;
  let i = 0;
  while (i < chunks.length) {
    if (chunks[i]!.kind === 'same') {
      i++;
      continue;
    }
    const before = i > 0 ? chunks[i - 1]!.words.slice(-keep) : [];
    const parts: Chunk[] = [];
    while (i < chunks.length && chunks[i]!.kind !== 'same') parts.push(chunks[i++]!);
    const after = i < chunks.length ? chunks[i]!.words.slice(0, keep) : [];
    views.push({ change: diff.changes[views.length]!, before, parts, after });
  }
  return views;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

/** One-line summary, such as "3 changes: 5 words removed, 9 words added." */
export function summarize(diff: TextDiff): string {
  if (diff.tooDifferent) return 'The texts are too different to compare word by word.';
  if (diff.changes.length === 0) return 'The text is the same in both files.';
  return `${plural(diff.changes.length, 'change')}: ${plural(diff.removed, 'word')} removed, ${plural(diff.added, 'word')} added.`;
}

// Control characters (except tab) and the marks that silently reverse text
// direction, which could make a file name in the report read differently.
const UNSAFE_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/**
 * The plain-text report that "Save report" downloads. Words come from the
 * PDFs and were already cleaned by MuPDF text extraction; file names are
 * cleaned here. A .txt file never runs anything.
 */
export function formatReport(diff: TextDiff, nameA: string, nameB: string): string {
  nameA = nameA.replace(UNSAFE_CHARS, '');
  nameB = nameB.replace(UNSAFE_CHARS, '');
  const lines = [
    'ILMPDF comparison report',
    '',
    `Older file: ${nameA} (${plural(diff.wordsA, 'word')})`,
    `Newer file: ${nameB} (${plural(diff.wordsB, 'word')})`,
    '',
    summarize(diff),
  ];
  diff.changes.forEach((c, n) => {
    lines.push('', `Change ${n + 1} (older file page ${c.pageA}, newer file page ${c.pageB})`);
    if (c.removed.length) lines.push(`  - removed: ${c.removed.join(' ')}`);
    if (c.added.length) lines.push(`  + added:   ${c.added.join(' ')}`);
  });
  return `${lines.join('\n')}\n`;
}
