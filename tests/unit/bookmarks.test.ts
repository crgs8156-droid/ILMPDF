import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { checkBookmarks, cleanTitle, MAX_TITLE, readBookmarks, writeBookmarks, type Bookmark } from '../../src/engines/mupdf-bookmarks';
import { canIndent, canMoveDown, canMoveUp, moveDown, moveUp, partFileName, planSplit, remove, shift } from '../../src/core/bookmarks';
import { makePdf } from '../fixtures/make-pdf';
// @ts-expect-error: plain JavaScript script without type declarations
import { buildTestFiles } from '../../scripts/make-test-pdfs.mjs';

const bm = (title: string, page: number | null, level = 0): Bookmark => ({ title, page, level, open: false });
const shape = (list: Bookmark[]) => list.map((b) => `${'  '.repeat(b.level)}${b.title}@${b.page === null ? '-' : b.page + 1}`);

describe('bookmarks engine', async () => {
  const files: { name: string; bytes: Uint8Array }[] = await buildTestFiles();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;

  it('reads nested bookmarks with their pages', () => {
    const { bookmarks, pages } = readBookmarks(mupdf, get('38-bookmarks-chapters.pdf'));
    expect(pages).toBe(12);
    expect(shape(bookmarks)).toEqual([
      'Chapter 1: Introduction@2',
      '  1.1 Background@3',
      '  1.2 Goals@4',
      'Chapter 2: Method@5',
      '  2.1 Data@6',
      '    2.1.1 Sources@7',
      '  2.2 Analysis@8',
      'Chapter 3: Results@9',
      '  3.1 Tables@10',
      '  3.2 Charts@11',
      'Appendix@12',
    ]);
    expect(bookmarks[0]!.open).toBe(true);
    expect(bookmarks[7]!.open).toBe(false);
  });

  it('a PDF without bookmarks gives an empty list', () => {
    expect(readBookmarks(mupdf, makePdf(3))).toEqual({ bookmarks: [], pages: 3 });
  });

  it('reads a hostile outline safely: loop cut, broken targets and scripts become "no page"', () => {
    const { bookmarks } = readBookmarks(mupdf, get('39-bookmarks-tricky.pdf'));
    expect(bookmarks).toHaveLength(11);
    const byTitle = (start: string) => bookmarks.find((b) => b.title.startsWith(start))!;
    expect(byTitle('Out of order').page).toBe(4);
    expect(byTitle('Web link').page).toBeNull();
    expect(byTitle('Runs a script').page).toBeNull();
    expect(byTitle('Runs a script').target).toBeUndefined();
    expect(byTitle('Broken target: page 1000').page).toBeNull();
    expect(byTitle('Broken target: not a page').page).toBeNull();
    expect(byTitle('Broken target: unknown name').page).toBeNull();
    expect(byTitle('Named destination').page).toBe(3);
    expect(byTitle('<img').title).toBe('<img src=x onerror=alert(1)> on page 3');
    expect(byTitle('Very long').title.length).toBeLessThanOrEqual(MAX_TITLE);
    // Direction-changing and control characters are removed from titles.
    expect(byTitle('Hidden').title).toBe('Hidden reversed text and a tab');
  });

  it('round-trips bookmarks and keeps the exact spot of an unchanged one', () => {
    const src = get('38-bookmarks-chapters.pdf');
    const { bookmarks } = readBookmarks(mupdf, src);
    const out = writeBookmarks(mupdf, src, bookmarks);
    const again = readBookmarks(mupdf, out).bookmarks;
    expect(shape(again)).toEqual(shape(bookmarks));
    expect(again.map((b) => b.open)).toEqual(bookmarks.map((b) => b.open));
    const doc = mupdf.Document.openDocument(out, 'application/pdf') as mupdf.PDFDocument;
    try {
      const goals = doc.getTrailer().get('Root').get('Outlines').get('First').get('Last');
      expect(goals.get('Title').asString()).toBe('1.2 Goals');
      expect(goals.get('Dest').get(1).asName()).toBe('XYZ');
      expect(goals.get('Dest').get(3).asNumber()).toBe(400);
    } finally {
      doc.destroy();
    }
  });

  it('saves edits: renamed, re-pointed, added, nested and heading-only bookmarks', () => {
    const src = get('38-bookmarks-chapters.pdf');
    const { bookmarks } = readBookmarks(mupdf, src);
    const edited: Bookmark[] = [
      { ...bookmarks[0]!, title: 'Intro' },
      { ...bookmarks[2]!, page: 9 },
      bm('Part two', null),
      bm('New', 0, 1),
      bm('Deeper', 1, 2),
    ];
    const out = writeBookmarks(mupdf, src, edited);
    expect(shape(readBookmarks(mupdf, out).bookmarks)).toEqual(['Intro@2', '  1.2 Goals@10', 'Part two@-', '  New@1', '    Deeper@2']);
    // A re-pointed bookmark gets a whole-page target, not its old spot.
    expect(readBookmarks(mupdf, out).bookmarks[1]!.target).toBe('#page=10&view=Fit');
    expect(new TextDecoder('latin1').decode(out)).not.toContain('Chapter 2: Method');
  });

  it('an empty list removes every bookmark', () => {
    const out = writeBookmarks(mupdf, get('38-bookmarks-chapters.pdf'), []);
    expect(readBookmarks(mupdf, out).bookmarks).toEqual([]);
    expect(new TextDecoder('latin1').decode(out)).not.toContain('/Outlines');
  });

  it('rewriting the tricky file drops the script and the web link', () => {
    const src = get('39-bookmarks-tricky.pdf');
    const out = writeBookmarks(mupdf, src, readBookmarks(mupdf, src).bookmarks);
    const text = new TextDecoder('latin1').decode(out);
    expect(text).not.toMatch(/JavaScript|app\.alert|example\.com/);
    expect(readBookmarks(mupdf, out).bookmarks).toHaveLength(11);
  });

  it('ignores a forged target that points at another page', () => {
    const src = get('38-bookmarks-chapters.pdf');
    const out = writeBookmarks(mupdf, src, [{ ...bm('X', 0), target: '#page=5&view=Fit' }, { ...bm('Y', 1), target: 'javascript:alert(1)' }]);
    expect(readBookmarks(mupdf, out).bookmarks.map((b) => b.target)).toEqual(['#page=1&view=Fit', '#page=2&view=Fit']);
  });

  it('refuses bad lists and locked files', () => {
    const src = makePdf(3);
    expect(() => writeBookmarks(mupdf, src, [bm('a', 0, 1)])).toThrow('indented more than one step');
    expect(() => writeBookmarks(mupdf, src, [bm('a', 3)])).toThrow('this PDF has 3 pages');
    expect(() => writeBookmarks(mupdf, src, [bm('x'.repeat(MAX_TITLE + 1), 0)])).toThrow('over');
    expect(() => readBookmarks(mupdf, makePdf(1, { encrypted: true }))).toThrow('Unlock it first');
    expect(checkBookmarks([bm('a', 0), bm('b', 1, 1), bm('c', 2, 2), bm('d', 0)], 3)).toBeNull();
  });

  it('cleans titles', () => {
    expect(cleanTitle('  a\u0000b\nc‮d  ')).toBe('a b c d');
  });
});

describe('bookmark list editing', () => {
  // A > A1 > A1a, A2; B
  const list = [bm('A', 0), bm('A1', 1, 1), bm('A1a', 1, 2), bm('A2', 2, 1), bm('B', 3)];

  it('moves a bookmark together with its sub-bookmarks', () => {
    expect(shape(moveDown(list, 1)).map((s) => s.trim())).toEqual(['A@1', 'A2@3', 'A1@2', 'A1a@2', 'B@4']);
    expect(shape(moveUp(list, 4)).map((s) => s.trim())).toEqual(['B@4', 'A@1', 'A1@2', 'A1a@2', 'A2@3']);
    expect(canMoveUp(list, 1)).toBe(false);
    expect(canMoveDown(list, 3)).toBe(false);
  });

  it('indents and outdents whole branches', () => {
    expect(shift(list, 4, 1).map((b) => b.level)).toEqual([0, 1, 2, 1, 1]);
    expect(shift(list, 1, -1).map((b) => b.level)).toEqual([0, 0, 1, 1, 0]);
    expect(canIndent(list, 0)).toBe(false);
    expect(canIndent(list, 1)).toBe(false);
    expect(canIndent(list, 3)).toBe(true);
  });

  it('deleting a bookmark moves its sub-bookmarks up', () => {
    const out = remove(list, 1);
    expect(shape(out)).toEqual(['A@1', '  A1a@2', '  A2@3', 'B@4']);
    expect(checkBookmarks(out, 5)).toBeNull();
  });
});

describe('split by bookmarks', () => {
  it('splits at top-level bookmarks with a start part for the cover', () => {
    const list = [bm('One', 1), bm('One.a', 2, 1), bm('Two', 4), bm('Three', 8)];
    expect(planSplit(list, 10, 0)).toEqual([
      { title: 'Start', pages: [0] },
      { title: 'One', pages: [1, 2, 3] },
      { title: 'Two', pages: [4, 5, 6, 7] },
      { title: 'Three', pages: [8, 9] },
    ]);
    expect(planSplit(list, 10, 1).map((p) => p.title)).toEqual(['Start', 'One', 'One.a', 'Two', 'Three']);
  });

  it('sorts by page, merges bookmarks on the same page and skips ones with no page', () => {
    const list = [bm('Late', 3), bm('Early', 0), bm('Also early', 0), bm('Nowhere', null)];
    expect(planSplit(list, 5, 0)).toEqual([
      { title: 'Early', pages: [0, 1, 2] },
      { title: 'Late', pages: [3, 4] },
    ]);
    expect(planSplit([bm('Nowhere', null)], 5, 0)).toEqual([]);
  });

  it('makes safe, numbered file names from titles', () => {
    expect(partFileName('report.pdf', 2, 12, 'Chapter 2: Method')).toBe('report-02-Chapter 2_ Method.pdf');
    const evil = partFileName('r.pdf', 1, 3, '../../<evil>/x');
    expect(evil).toMatch(/^r-1-.*\.pdf$/);
    expect(evil).not.toMatch(/[/\\<>]/);
    expect(partFileName('r.pdf', 1, 1, '')).toBe('r-1-document.pdf');
  });
});
