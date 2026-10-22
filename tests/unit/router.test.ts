import { describe, expect, it } from 'vitest';
import { Trail, parentOf, parseHash, titleFor, toHash } from '../../src/core/router';

const IDS = ['sign', 'merge'];

describe('parseHash', () => {
  it('reads the home page in every spelling', () => {
    for (const h of ['', '#', '#/', '#//']) expect(parseHash(h, IDS)).toEqual({ kind: 'home' });
  });
  it('reads a tool and its file step', () => {
    expect(parseHash('#/sign', IDS)).toEqual({ kind: 'tool', id: 'sign', file: false });
    expect(parseHash('#sign', IDS)).toEqual({ kind: 'tool', id: 'sign', file: false });
    expect(parseHash('#/sign/file', IDS)).toEqual({ kind: 'tool', id: 'sign', file: true });
    expect(parseHash('#/sign/', IDS)).toEqual({ kind: 'tool', id: 'sign', file: false });
  });
  it('reports unknown addresses instead of silently showing home', () => {
    expect(parseHash('#/nope', IDS)).toEqual({ kind: 'missing', path: 'nope' });
    expect(parseHash('#/sign/other', IDS)).toEqual({ kind: 'missing', path: 'sign/other' });
    expect(parseHash('#/sign/file/x', IDS)).toEqual({ kind: 'missing', path: 'sign/file/x' });
  });
  it('round-trips through toHash', () => {
    for (const h of ['#/', '#/sign', '#/sign/file', '#/nope']) expect(toHash(parseHash(h, IDS))).toBe(h);
  });
});

describe('parentOf', () => {
  it('steps from file to picker to home', () => {
    expect(parentOf({ kind: 'tool', id: 'sign', file: true })).toEqual({ kind: 'tool', id: 'sign', file: false });
    expect(parentOf({ kind: 'tool', id: 'sign', file: false })).toEqual({ kind: 'home' });
    expect(parentOf({ kind: 'missing', path: 'x' })).toEqual({ kind: 'home' });
    expect(parentOf({ kind: 'home' })).toEqual({ kind: 'home' });
  });
});

describe('titleFor', () => {
  it('names the tool in the tab title', () => {
    expect(titleFor({ kind: 'home' })).toBe('ILMPDF');
    expect(titleFor({ kind: 'tool', id: 'sign', file: true }, 'Sign PDF')).toBe('Sign PDF · ILMPDF');
    expect(titleFor({ kind: 'missing', path: 'x' })).toBe('Not found · ILMPDF');
  });
});

describe('Trail', () => {
  it('tells Back apart from a new visit', () => {
    const t = new Trail('#/');
    expect(t.visit('#/sign')).toBe(false);
    expect(t.visit('#/sign/file')).toBe(false);
    expect(t.previousIs('#/sign')).toBe(true);
    expect(t.visit('#/sign')).toBe(true);
    expect(t.previousIs('#/')).toBe(true);
    expect(t.visit('#/')).toBe(true);
    expect(t.previousIs('#/')).toBe(false);
  });
  it('ignores a repeat of the current entry', () => {
    const t = new Trail('#/');
    t.visit('#/sign');
    t.visit('#/sign');
    expect(t.previousIs('#/')).toBe(true);
  });
  it('replaces the current entry without growing', () => {
    const t = new Trail('#/');
    t.visit('#/sign/file');
    t.replace('#/sign');
    expect(t.previousIs('#/')).toBe(true);
  });
});
