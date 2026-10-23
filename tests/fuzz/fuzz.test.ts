// Hostile-PDF fuzzing (Phase 5 security audit, area C). Every synthetic
// attack file from tests/fixtures/hostile-pdfs.ts, plus randomly corrupted
// copies of normal files, goes through every engine operation in
// tests/fuzz/runner.ts. A case passes when the engine either finishes or
// refuses the file within the time limit, without trying the network.
// Crashes are allowed (in the app the worker dies and the user sees an
// error) but are listed so they can be looked at.
//
// npm run test:fuzz (part of verify) runs a short random round; npm run fuzz runs the long one
// (ILMPDF_FUZZ_CASES=20000). Set ILMPDF_FUZZ_SEED to replay a round.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hostilePdfs, mutate, seededRandom, type HostileFile } from '../fixtures/hostile-pdfs';
import { makePdf, makeScriptedPdf } from '../fixtures/make-pdf';
import { buildRunner, FuzzPool, type Outcome } from './pool';

const CASE_TIMEOUT_MS = 30_000;
const RANDOM_CASES = Number(process.env.ILMPDF_FUZZ_CASES ?? 40);
const SEED = Number(process.env.ILMPDF_FUZZ_SEED ?? 20261022);

// Keep in step with OPS in tests/fuzz/runner.ts.
const OPS = [
  'pdf-lib pageCount', 'pdf-lib readMetadata', 'pdf-lib stripMetadata', 'pdf-lib pageNumbers',
  'mupdf inspect', 'mupdf repair', 'mupdf extractText', 'mupdf sanitize', 'mupdf compress',
  'mupdf readForm', 'mupdf readBookmarks', 'mupdf extractImages', 'mupdf flatten',
];

type Problem = { file: string; op: string; outcome: Outcome };

let pool: FuzzPool;

beforeAll(async () => {
  pool = new FuzzPool(await buildRunner(), CASE_TIMEOUT_MS);
}, 120_000);

afterAll(async () => {
  await pool?.close();
});

/** Runs every op on one file; returns hangs and network attempts (failures) and crashes (notes). */
async function fuzzFile(file: HostileFile): Promise<{ failures: Problem[]; crashes: Problem[] }> {
  const failures: Problem[] = [];
  const crashes: Problem[] = [];
  for (const op of OPS) {
    const outcome = await pool.run(op, file.bytes);
    if (outcome.kind === 'hang') failures.push({ file: file.name, op, outcome });
    else if (outcome.kind === 'crash') crashes.push({ file: file.name, op, outcome });
    else if (outcome.netAttempts > 0) failures.push({ file: file.name, op, outcome });
  }
  return { failures, crashes };
}

describe('fuzz harness', () => {
  it('notices a case that hangs, stops it, and carries on with a fresh worker', async () => {
    const quick = new FuzzPool(await buildRunner(), 2_000);
    expect(await quick.run('selftest hang', makePdf())).toEqual({ kind: 'hang' });
    expect((await quick.run('pdf-lib pageCount', makePdf(2))).kind).toBe('ok');
    await quick.close();
  }, 60_000);

  it('notices a network attempt', async () => {
    expect(await pool.run('selftest network', makePdf())).toEqual({ kind: 'ok', netAttempts: 1 });
  });
});

describe('hostile PDF fuzzing', async () => {
  const files = await hostilePdfs();

  it.each(files.map((f) => [f.name, f] as const))('%s is refused or handled safely by every engine', async (_name, file) => {
    const { failures, crashes } = await fuzzFile(file);
    if (crashes.length) console.warn(`[fuzz] ${file.name}: worker crashed in ${crashes.map((c) => c.op).join(', ')}`);
    expect(failures, file.why).toEqual([]);
  }, OPS.length * CASE_TIMEOUT_MS + 10_000);

  it(`${RANDOM_CASES} randomly corrupted files are refused or handled safely (seed ${SEED})`, async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 3; i++) doc.addPage([300, 300]).drawText(`Page ${i + 1}`, { x: 20, y: 150, size: 24, font });
    doc.setTitle('Fuzz seed');
    const seeds = [makePdf(3), makeScriptedPdf(), await doc.save({ useObjectStreams: false })];
    const rand = seededRandom(SEED);
    const failures: Problem[] = [];
    let crashes = 0;
    for (let i = 0; i < RANDOM_CASES; i++) {
      const base = seeds[i % seeds.length]!;
      const result = await fuzzFile({ name: `random-${SEED}-${i}`, why: 'random corruption', bytes: mutate(base, rand) });
      failures.push(...result.failures);
      crashes += result.crashes.length;
    }
    if (crashes) console.warn(`[fuzz] random round: ${crashes} worker crash(es)`);
    expect(failures).toEqual([]);
  }, Math.max(600_000, RANDOM_CASES * 20_000));
});
