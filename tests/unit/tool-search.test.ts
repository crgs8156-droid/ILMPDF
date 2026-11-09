import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_KEYWORDS, fold, searchTools, type Searchable } from '../../src/core/tool-search';

// The registry imports Svelte components, so read its tools as text.
const registry = readFileSync(new URL('../../src/tools/registry.ts', import.meta.url), 'utf8');
const tools: Searchable[] = [
  ...registry.matchAll(/\{ id: '([a-z-]+)', name: '([^']+)', blurb: '([^']+)', group: '([A-Za-z]+)'/g),
].map((m) => ({ id: m[1]!, name: m[2]!, blurb: m[3]!, group: m[4]! }));

const ids = (q: string) => searchTools(tools, q).map((t) => t.id);

describe('tool search', () => {
  it('reads every tool from the registry', () => {
    expect(tools.length).toBe([...registry.matchAll(/\{ id: '/g)].length);
    expect(tools.length).toBeGreaterThan(20);
  });

  it('every tool has keywords and every keyword entry belongs to a tool', () => {
    expect(Object.keys(TOOL_KEYWORDS).sort()).toEqual(tools.map((t) => t.id).sort());
  });

  it('an empty or blank query finds nothing', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('a name prefix ranks that tool first', () => {
    expect(ids('comp').slice(0, 2).sort()).toEqual(['compare', 'compress']);
    expect(ids('compr')[0]).toBe('compress');
    expect(ids('Compa')[0]).toBe('compare');
    expect(ids('sign')[0]).toBe('sign');
    expect(ids('merge')).toEqual(['merge']);
  });

  it('everyday words find the right tools', () => {
    expect(ids('password').slice(0, 2).sort()).toEqual(['protect', 'unlock']);
    expect(ids('smaller')[0]).toBe('compress');
    expect(ids('join')[0]).toBe('merge');
    expect(ids('black out')[0]).toBe('redact');
    expect(ids('jpg')).toEqual(expect.arrayContaining(['images-to-pdf', 'pdf-to-images']));
    expect(ids('grayscale')[0]).toBe('recolor');
  });

  it('every typed word must match', () => {
    expect(ids('pdf images')).toEqual(expect.arrayContaining(['pdf-to-images', 'images-to-pdf']));
    expect(ids('password zebra')).toEqual([]);
  });

  it('ignores capitals, accents and punctuation', () => {
    expect(fold('  Résumé—PDF!  ')).toBe('resume pdf');
    expect(ids('PASSWÖRD').slice(0, 2).sort()).toEqual(['protect', 'unlock']);
    expect(ids('pässword').slice(0, 2).sort()).toEqual(['protect', 'unlock']);
    expect(ids('headers & footers')[0]).toBe('header-footer');
  });

  it('a group name lists its tools', () => {
    expect(ids('privacy').sort()).toEqual(['metadata', 'redact', 'remove-scripts']);
  });

  it('nonsense finds nothing', () => {
    expect(ids('zzqx')).toEqual([]);
  });

  it('treats typed text as plain text, never as a pattern', () => {
    expect(() => ids('.*(+[')).not.toThrow();
    expect(ids('.*')).toEqual([]);
  });
});
