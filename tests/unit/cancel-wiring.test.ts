// Every job a tool starts must be handed the tool's Cancel signal, or
// Cancel would leave that job running (and saving). This reads the tool
// sources and finds each call to a job runner that has no `signal` in its
// arguments. A call that really should not be cancellable (a quick read when
// a file is chosen, which saves nothing) is marked with a `no-cancel:`
// comment on the line above.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNNERS = ['runPdfJob', 'runMupdfJob', 'runOcrJob', 'cleanIf', 'removeScripts', 'runBatch'];

/** Text between the call's own brackets, or null if it is not a call. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('unbalanced call');
}

export function unwiredCalls(src: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`\\b(${RUNNERS.join('|')})\\(`, 'g');
  for (const m of src.matchAll(pattern)) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index));
    if (/^\s*(import|export|\/\/|\*)/.test(line) || /\bfunction\s+$/.test(src.slice(lineStart, m.index))) continue;
    const before = src.slice(src.lastIndexOf('\n', lineStart - 2) + 1, lineStart);
    if (before.includes('no-cancel:')) continue;
    if (!/\bsignal\b/.test(callArgs(src, m.index + m[0].length - 1))) found.push(line.trim());
  }
  return found;
}

describe('Cancel wiring', () => {
  it('finds a call that forgets the signal', () => {
    expect(unwiredCalls("job.run(async (signal) => {\n  await runPdfJob({ op: 'merge', files });\n});")).toHaveLength(1);
    expect(unwiredCalls("await runPdfJob({ op: 'merge', files }, { signal });")).toEqual([]);
    expect(unwiredCalls("// no-cancel: quick read\nawait runPdfJob({ op: 'pageCount', file });")).toEqual([]);
  });

  it('every tool hands its Cancel signal to every job it starts', () => {
    const dir = path.resolve(__dirname, '../../src/tools');
    const files = readdirSync(dir).filter((f) => f.endsWith('.svelte'));
    expect(files.length).toBeGreaterThan(20);
    const missing = files.flatMap((f) => unwiredCalls(readFileSync(path.join(dir, f), 'utf8')).map((l) => `${f}: ${l}`));
    expect(missing).toEqual([]);
  });

  it('every tool with a main action shows the Cancel controls', () => {
    const dir = path.resolve(__dirname, '../../src/tools');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.svelte'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      const runs = [...src.matchAll(/(\w+)\.run\(async \(signal\)/g)].map((m) => m[1]!);
      // Quick reads when a file is chosen (Forms, Metadata) don't need a button.
      for (const name of new Set(runs.filter((r) => r !== 'reading'))) {
        expect(src, `${f}: ${name}`).toContain(`<RunStatus run={${name}} />`);
      }
    }
  });
});
