import { describe, expect, it } from 'vitest';
import { TOOL_ICONS, groupClass } from '../../src/lib/icons';
import { readFileSync } from 'node:fs';

// The registry imports Svelte components, so read its ids and groups as text.
const registry = readFileSync(new URL('../../src/tools/registry.ts', import.meta.url), 'utf8');
const ids = [...registry.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]!);
const groups = [...new Set([...registry.matchAll(/group: '([A-Za-z]+)'/g)].map((m) => m[1]!))];
const css = readFileSync(new URL('../../src/app.css', import.meta.url), 'utf8');

describe('icons', () => {
  it('every tool has an icon and every icon belongs to a tool', () => {
    expect(ids.length).toBeGreaterThan(20);
    expect(Object.keys(TOOL_ICONS).sort()).toEqual([...ids].sort());
  });
  it('icon paths use only SVG path commands and numbers', () => {
    for (const d of Object.values(TOOL_ICONS)) expect(d).toMatch(/^[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/);
  });
  it('every group has a colour class in app.css', () => {
    for (const g of groups) expect(css).toContain(`.${groupClass(g)} {`);
  });
});
