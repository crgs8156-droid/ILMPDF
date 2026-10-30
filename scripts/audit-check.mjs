// Dependency audit for CI and `npm run security:daily`:
//   node scripts/audit-check.mjs
// Runs `npm audit` and fails on every known advisory, of any severity,
// except the few listed in ALLOWED below. Each exception is for one exact
// advisory in one exact package, approved by the owner, with the reason and
// a decision record in docs/decisions/. An exception stops working (the
// check fails) when it expires, when a fix exists, or when the advisory is
// gone, so it is reviewed or removed instead of lingering.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = [
  {
    advisory: 'GHSA-gcqx-w48m-w2h4',
    pkg: 'deepmerge',
    approved: '2026-10-30',
    // 30 days. After this the check fails until the owner reviews it again.
    expires: '2026-11-29',
    record: 'docs/decisions/2026-10-30-deepmerge-audit-exception.md',
    reason:
      'Prototype poisoning in deepmerge mergeObject(). Only @sveltejs/vite-plugin-svelte uses it, to merge its own build ' +
      'options while building; it is not in dist/ and never runs in the app. No fixed version exists yet.',
  },
];

const run = spawnSync('npm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8' });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error('npm audit gave no readable answer (offline?):', run.stderr.trim());
  process.exit(1);
}
if (report.error) {
  console.error('npm audit failed:', report.error.summary ?? JSON.stringify(report.error));
  process.exit(1);
}

const idOf = (url) => /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/.exec(url ?? '')?.[0] ?? url;
const problems = [];
const seen = new Set();
const today = new Date().toISOString().slice(0, 10);

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  // `via` holds advisories (objects) and the names of vulnerable packages
  // this one depends on (strings); those are reported under their own name.
  for (const via of vuln.via) {
    if (typeof via === 'string') continue;
    const id = idOf(via.url);
    const allowed = ALLOWED.find((a) => a.advisory === id && a.pkg === name);
    if (!allowed) {
      problems.push(`${name}: ${via.title} (${via.severity}) ${via.url}`);
      continue;
    }
    seen.add(id);
    if (today > allowed.expires) problems.push(`${name}: the exception for ${id} expired on ${allowed.expires}. Review it again (${allowed.record}).`);
    else if (vuln.fixAvailable) problems.push(`${name}: a fix now exists for ${id}. Update the package and remove its exception in scripts/audit-check.mjs.`);
    else console.log(`allowed  ${name} ${id} until ${allowed.expires} (${allowed.record}): ${allowed.reason}`);
  }
}

for (const a of ALLOWED) {
  if (!seen.has(a.advisory)) problems.push(`${a.pkg} ${a.advisory} is no longer reported. Remove its exception in scripts/audit-check.mjs.`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  process.exit(1);
}
console.log('npm audit: no advisories beyond the approved exceptions.');
