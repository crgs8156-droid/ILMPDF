// Makes sure the network watcher (tests/e2e/fixtures.ts) can't be skipped:
// every browser test file must take `test` from it, and every tool in the
// registry must be opened by at least one browser test, so every tool runs
// watched at least once.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const E2E = path.resolve(__dirname, '../e2e');
const specs = readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'));
const source = (f: string) => readFileSync(path.join(E2E, f), 'utf8');

describe('network watcher coverage', () => {
  it('every browser test file uses the watched test from ./fixtures', () => {
    expect(specs.length).toBeGreaterThan(0);
    for (const file of specs) {
      const text = source(file);
      expect(text, file).toMatch(/^import \{[^}]*\btest\b[^}]*\} from '\.\/fixtures';$/m);
      // Types may still come from Playwright, but never the test function.
      expect(text, file).not.toMatch(/^import \{(?![^}]*\btype\b)[^}]*\btest\b[^}]*\} from '@playwright\/test'/m);
      expect(text, file).not.toMatch(/^import(?! type)[^\n]*\btest\b[^\n]*from '@playwright\/test'/m);
    }
  });

  it('every tool is opened by at least one browser test', () => {
    const registry = readFileSync(path.resolve(__dirname, '../../src/tools/registry.ts'), 'utf8');
    const ids = [...registry.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(20);
    const all = specs.map(source).join('\n');
    const missing = ids.filter((id) => !all.includes(`openTool(page, '${id}'`) && !all.includes(`#/${id}`));
    expect(missing, 'tools no browser test opens').toEqual([]);
  });
});
