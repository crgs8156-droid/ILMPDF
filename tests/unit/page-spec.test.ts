import { describe, expect, it } from 'vitest';
import { everyNPages, parsePageGroups } from '../../src/core/page-spec';

describe('parsePageGroups', () => {
  it('parses single pages, ranges and open ranges', () => {
    expect(parsePageGroups('1-3, 5, 8-', 9)).toEqual({ ok: true, groups: [[0, 1, 2], [4], [7, 8]] });
    expect(parsePageGroups('-2', 5)).toEqual({ ok: true, groups: [[0, 1]] });
  });
  it('rejects bad input', () => {
    expect(parsePageGroups('', 5).ok).toBe(false);
    expect(parsePageGroups('0', 5).ok).toBe(false);
    expect(parsePageGroups('6', 5).ok).toBe(false);
    expect(parsePageGroups('4-2', 5).ok).toBe(false);
    expect(parsePageGroups('a-b', 5).ok).toBe(false);
    expect(parsePageGroups('1;2', 5).ok).toBe(false);
  });
});

describe('everyNPages', () => {
  it('chunks pages', () => {
    expect(everyNPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(everyNPages(3, 0)).toEqual([[0], [1], [2]]);
  });
});
