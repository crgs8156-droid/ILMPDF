import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { changeViews, diffWords, formatReport, summarize, toWords } from '../../src/core/word-diff';
import { diffPixels, type Pixels } from '../../src/core/pixel-diff';
import { compareText } from '../../src/engines/mupdf-ops';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

// Rebuilds the newer text from the older one and the diff, which proves the
// diff is complete: every word is accounted for, in order.
function rebuild(diff: ReturnType<typeof diffWords>) {
  const older = diff.chunks.filter((c) => c.kind !== 'added').flatMap((c) => c.words);
  const newer = diff.chunks.filter((c) => c.kind !== 'removed').flatMap((c) => c.words);
  return { older: older.join(' '), newer: newer.join(' ') };
}

describe('word diff', () => {
  it('finds nothing in identical text, even with different line breaks', () => {
    const diff = diffWords(['one two\nthree'], ['one   two three']);
    expect(diff.changes).toEqual([]);
    expect(summarize(diff)).toBe('The text is the same in both files.');
  });

  it('reports a replaced word with its page numbers', () => {
    const diff = diffWords(['intro', 'the cost was 1200 pounds'], ['intro', 'the cost was 1500 pounds']);
    expect(diff.changes).toEqual([{ pageA: 2, pageB: 2, removed: ['1200'], added: ['1500'] }]);
    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(1);
  });

  it('handles additions at the start and the end, and empty texts', () => {
    expect(diffWords(['b c'], ['a b c d']).changes).toEqual([
      { pageA: 1, pageB: 1, removed: [], added: ['a'] },
      { pageA: 1, pageB: 1, removed: [], added: ['d'] },
    ]);
    expect(diffWords([], ['new words']).added).toBe(2);
    expect(diffWords(['old words'], ['']).removed).toBe(2);
    expect(diffWords([], []).changes).toEqual([]);
  });

  it('finds the smallest set of changes in mixed edits', () => {
    const a = 'the quick brown fox jumps over the lazy dog'.split(' ');
    const b = 'a quick red fox jumped over the very lazy dog today'.split(' ');
    const diff = diffWords([a.join(' ')], [b.join(' ')]);
    expect(rebuild(diff)).toEqual({ older: a.join(' '), newer: b.join(' ') });
    expect(diff.removed).toBe(3); // the, brown, jumps
    expect(diff.added).toBe(5); // a, red, jumped, very, today
  });

  it('stays correct on random edits', () => {
    let seed = 1;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let round = 0; round < 30; round++) {
      const a = Array.from({ length: 60 + rand(60) }, () => `w${rand(12)}`);
      const b = a.filter(() => rand(5) > 0).flatMap((w) => (rand(6) === 0 ? [w, `x${rand(9)}`] : [w]));
      const diff = diffWords([a.join(' ')], [b.join(' ')]);
      expect(rebuild(diff)).toEqual({ older: a.join(' '), newer: b.join(' ') });
      expect(diff.removed + diff.added).toBeLessThanOrEqual(a.length + b.length);
    }
  });

  it('gives up cleanly when the texts are too different', () => {
    const diff = diffWords(['a b c d e f'], ['u v w x y z'], 4);
    expect(diff.tooDifferent).toBe(true);
    expect(diff.chunks).toEqual([]);
    expect(summarize(diff)).toContain('too different');
  });

  it('treats ligatures and look-alike forms as the same letters', () => {
    expect(toWords(['ﬁle ｆｕｌｌ']).map((w) => w.word)).toEqual(['file', 'full']);
    expect(diffWords(['the ﬁle'], ['the file']).changes).toEqual([]);
  });

  it('shows each change with a little context', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`);
    const changed = words.map((w) => (w === 'w15' ? 'NEW' : w));
    const diff = diffWords([words.join(' ')], [changed.join(' ')]);
    const [view] = changeViews(diff, 3);
    expect(view!.before).toEqual(['w12', 'w13', 'w14']);
    expect(view!.parts.map((p) => [p.kind, p.words])).toEqual([
      ['removed', ['w15']],
      ['added', ['NEW']],
    ]);
    expect(view!.after).toEqual(['w16', 'w17', 'w18']);
  });

  it('writes a plain report without hidden characters in file names', () => {
    const diff = diffWords(['pay in 30 days'], ['pay in 14 days']);
    const report = formatReport(diff, 'old‮.pdf', 'new\n.pdf');
    expect(report).toContain('Older file: old.pdf (4 words)');
    expect(report).toContain('Newer file: new.pdf');
    expect(report).toContain('Change 1 (older file page 1, newer file page 1)');
    expect(report).toContain('- removed: 30');
    expect(report).toContain('+ added:   14');
  });
});

describe('pixel diff', () => {
  const page = (width: number, height: number, paint?: (x: number, y: number) => number[]): Pixels => {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    if (paint) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
      }
    }
    return { width, height, data };
  };

  it('finds no change between identical pages and ignores faint noise', () => {
    expect(diffPixels(page(10, 10), page(10, 10)).changed).toBe(0);
    expect(diffPixels(page(10, 10), page(10, 10, () => [245, 245, 245, 255])).changed).toBe(0);
  });

  it('marks changed pixels in red', () => {
    const dot = page(10, 10, (x, y) => (x < 2 && y < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const d = diffPixels(page(10, 10), dot);
    expect(d.changed).toBe(10);
    expect(d.ratio).toBeCloseTo(0.1);
    expect([...d.image.data.slice(0, 4)]).toEqual([230, 30, 30, 255]);
  });

  it('counts the extra area of a bigger page as changed', () => {
    const d = diffPixels(page(10, 10), page(10, 12));
    expect(d.image.height).toBe(12);
    expect(d.changed).toBe(20);
  });
});

describe('compareText (MuPDF)', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  it('finds the changes in the two sample versions', () => {
    const diff = compareText(mupdf, get('23-compare-original.pdf'), get('24-compare-changed.pdf'));
    expect(diff.pagesA).toBe(3);
    expect(diff.pagesB).toBe(4);
    const removed = diff.changes.flatMap((c) => c.removed);
    const added = diff.changes.flatMap((c) => c.added);
    expect(removed).toEqual(['1200', '30']);
    expect(added).toEqual(expect.arrayContaining(['1500', '14', 'late', 'New', 'two.']));
    // Pages 1 and 3 have the same text in both versions.
    expect(diff.changes.every((c) => c.pageA >= 2 && c.pageB >= 2)).toBe(true);
  });

  it('says which file needs a password', () => {
    expect(() => compareText(mupdf, makePdf(1), get('14-password-aes256-is-test.pdf'))).toThrow(/^The newer file: .*password/);
  });
});
