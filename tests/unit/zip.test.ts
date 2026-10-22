import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { crc32, makeZip, uniqueNames, MAX_ZIP_ENTRIES } from '../../src/core/zip';
import { readZip } from '../fixtures/read-zip';
import { batchReport, batchZip, REPORT_NAME, zipName, type BatchResult } from '../../src/core/batch';

const enc = new TextEncoder();
const dec = new TextDecoder();

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('crc32', () => {
  it('matches the standard check value and Node', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const random = crypto.getRandomValues(new Uint8Array(10_000));
    expect(crc32(random)).toBe(nodeCrc32(random));
  });
});

describe('makeZip', () => {
  it('stores files that read back byte for byte, with UTF-8 names', async () => {
    const a = crypto.getRandomValues(new Uint8Array(5000));
    const b = enc.encode('hello');
    const blob = makeZip([
      { name: 'Résumé – final.pdf', bytes: a },
      { name: 'notes.txt', bytes: b },
      { name: 'empty.txt', bytes: new Uint8Array() },
    ]);
    expect(blob.type).toBe('application/zip');
    const files = readZip(await bytesOf(blob));
    expect(files.map((f) => f.name)).toEqual(['Résumé – final.pdf', 'notes.txt', 'empty.txt']);
    expect(files[0]!.data).toEqual(a);
    expect(dec.decode(files[1]!.data)).toBe('hello');
    expect(files[2]!.data.length).toBe(0);
    for (const f of files) {
      expect(f.method).toBe(0);
      expect(f.flags & 0x0800).toBe(0x0800);
      expect(f.crc).toBe(crc32(f.data));
    }
  });

  it('makes an empty but valid archive', async () => {
    const zip = await bytesOf(makeZip([]));
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('refuses names that could escape the unzip folder', () => {
    for (const name of ['../evil.pdf', 'a/b.pdf', 'a\\b.pdf', '..', '', 'line\nbreak.pdf', 'x'.repeat(256)]) {
      expect(() => makeZip([{ name, bytes: new Uint8Array(1) }]), name).toThrow(/Unsafe file name/);
    }
  });

  it('refuses too many files', () => {
    const many = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ name: `${i}.txt`, bytes: new Uint8Array() }));
    expect(() => makeZip(many)).toThrow(/at most/);
  });

  // Archive Utility on the Mac uses the same format checks as Info-ZIP.
  it.runIf(hasUnzip())('passes the system unzip integrity test', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ilmpdf-zip-'));
    try {
      const file = path.join(dir, 'test.zip');
      writeFileSync(file, await bytesOf(makeZip([{ name: 'a.pdf', bytes: enc.encode('%PDF-1.7 test') }, { name: 'Café.txt', bytes: enc.encode('ok') }])));
      const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
      expect(out).toContain('No errors detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('uniqueNames', () => {
  it('numbers duplicates, ignoring case like the Mac does', () => {
    expect(uniqueNames(['a.pdf', 'a.pdf', 'A.pdf', 'b', 'b', 'a (2).pdf'])).toEqual([
      'a.pdf',
      'a (2).pdf',
      'A (3).pdf',
      'b',
      'b (2)',
      'a (2) (2).pdf',
    ]);
  });
});

describe('batch ZIP and report', () => {
  const when = new Date('2026-10-21T20:00:00Z');
  const results: BatchResult[] = [
    { source: 'one.pdf', output: { name: 'one-compressed.pdf', bytes: enc.encode('%PDF-1') }, note: '40% smaller.' },
    { source: 'one.pdf', output: { name: 'one-compressed.pdf', bytes: enc.encode('%PDF-2') } },
    { source: 'bad\nOK      forged.pdf', error: 'This file could not be read as a PDF. It may be damaged.' },
  ];

  it('lists every file, and a file name cannot fake extra report lines', () => {
    const report = batchReport('compress', results, when);
    expect(report).toContain('Action: Compress');
    expect(report).toContain('Done: 2 of 3 files');
    expect(report).toContain('OK      one.pdf -> one-compressed.pdf  (40% smaller.)');
    expect(report).toContain('FAILED  bad_OK      forged.pdf: This file could not be read');
    expect(report.split('\n').filter((l) => l.startsWith('OK'))).toHaveLength(2);
  });

  it('packs results with unique names plus the report', async () => {
    const files = readZip(await bytesOf(batchZip('compress', results, when)!));
    expect(files.map((f) => f.name)).toEqual(['one-compressed.pdf', 'one-compressed (2).pdf', REPORT_NAME]);
    expect(dec.decode(files[1]!.data)).toBe('%PDF-2');
    expect(dec.decode(files[2]!.data)).toContain('ILMPDF batch report');
  });

  it('returns nothing when every file failed', () => {
    expect(batchZip('repair', [{ source: 'x.pdf', error: 'nope' }], when)).toBeNull();
  });

  it('names the ZIP after the action', () => {
    expect(zipName('compress')).toBe('ilmpdf-batch-compressed.zip');
    expect(zipName('unlock')).toBe('ilmpdf-batch-unlocked.zip');
  });
});
