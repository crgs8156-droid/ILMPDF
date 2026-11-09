import { describe, expect, it } from 'vitest';
import { inZip, planDownloads, type OutFile } from '../../src/core/save';
import { readZip } from '../fixtures/read-zip';

const enc = new TextEncoder();
const dec = new TextDecoder();
const file = (name: string, text: string, type?: string): OutFile =>
  type ? { name, bytes: enc.encode(text), type } : { name, bytes: enc.encode(text) };

describe('planDownloads', () => {
  it('packs many files into one ZIP that reads back byte for byte', async () => {
    const out = planDownloads([file('a-part-1.pdf', 'one'), file('a-part-2.pdf', 'two')], 'a-parts.zip', true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'a-parts.zip', type: 'application/zip' });
    const entries = readZip(new Uint8Array(await (out[0]!.bytes as Blob).arrayBuffer()));
    expect(entries.map((e) => [e.name, dec.decode(e.data)])).toEqual([
      ['a-part-1.pdf', 'one'],
      ['a-part-2.pdf', 'two'],
    ]);
  });

  it('gives clashing names inside the ZIP their own number', async () => {
    const out = planDownloads([file('Part.pdf', '1'), file('part.pdf', '2')], 'x.zip', true);
    const entries = readZip(new Uint8Array(await (out[0]!.bytes as Blob).arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(['Part.pdf', 'part (2).pdf']);
  });

  it('saves each file on its own when the ZIP option is off, keeping its type', () => {
    const out = planDownloads([file('p1.png', 'x', 'image/png'), file('p2.pdf', 'y')], 'x.zip', false);
    expect(out.map((d) => [d.name, d.type])).toEqual([
      ['p1.png', 'image/png'],
      ['p2.pdf', 'application/pdf'],
    ]);
  });

  it('never zips a single file', () => {
    const out = planDownloads([file('only.jpg', 'x', 'image/jpeg')], 'x.zip', true);
    expect(out).toEqual([{ name: 'only.jpg', bytes: enc.encode('x'), type: 'image/jpeg' }]);
  });

  it('saves nothing when there is nothing', () => {
    expect(planDownloads([], 'x.zip', true)).toEqual([]);
  });

  it('refuses unsafe names instead of zipping them', () => {
    expect(() => planDownloads([file('../evil.pdf', '1'), file('ok.pdf', '2')], 'x.zip', true)).toThrow(/Unsafe file name/);
  });
});

describe('inZip', () => {
  it('names the ZIP for the done message, or adds nothing', () => {
    expect(inZip('a-parts.zip')).toBe(' in a-parts.zip');
    expect(inZip(null)).toBe('');
  });
});
