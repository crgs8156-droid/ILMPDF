// Quick check to run before using ILMPDF for real documents:
//   npm run security:daily
// 1. Your copy is the reviewed code: on main, no local edits, same commit
//    as GitHub (asks GitHub for the latest main; nothing else is sent).
// 2. The static security checks (lockfile, .npmrc, code scans, built app).
// 3. The CSP, security headers and 127.0.0.1 binding are the approved ones.
// 4. npm audit and registry signatures for known vulnerabilities.
// If anything fails, don't open real documents until it is fixed.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const failures = [];

function step(title, fn) {
  console.log(`\n== ${title}`);
  try {
    const problems = fn();
    if (problems.length) failures.push(title);
    for (const p of problems) console.log(`FAIL  ${p}`);
    if (!problems.length) console.log('ok');
  } catch (e) {
    failures.push(title);
    console.log(`FAIL  ${e instanceof Error ? e.message : e}`);
  }
}

step('Your copy matches the reviewed code on GitHub', () => {
  const problems = [];
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') problems.push(`you are on "${branch}", not main: git checkout main`);
  if (git('status', '--porcelain', '--untracked-files=no')) problems.push('files were changed locally: git status shows them');
  const fetched = spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: ROOT });
  if (fetched.status !== 0) problems.push('could not reach GitHub to compare (offline?); try again online');
  else if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) problems.push('not the same commit as GitHub main: git pull, then npm ci and npm run build');
  return problems;
});

step('The built app is up to date', () => {
  const index = path.join(ROOT, 'dist', 'index.html');
  if (!existsSync(index)) return ['no build yet: npm run build'];
  const commitTime = Number(git('log', '-1', '--format=%ct')) * 1000;
  return statSync(index).mtimeMs < commitTime ? ['the build is older than the code: npm run build'] : [];
});

step('Static security checks', () => {
  const r = spawnSync('node', [path.join(ROOT, 'scripts', 'security-check.mjs'), '--dist'], { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0 ? [] : ['see the FAIL lines above'];
});

step('Security headers and server binding are the approved ones', () => {
  const vitest = path.join(ROOT, 'node_modules', '.bin', 'vitest');
  const r = spawnSync(vitest, ['run', 'tests/unit/security-headers.test.ts'], { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0 ? [] : ['the CSP, a header or the 127.0.0.1 binding changed'];
});

step('Known vulnerabilities and package signatures (npm audit)', () => {
  const r = spawnSync('npm', ['run', '--silent', 'audit:deps'], { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0 ? [] : ['npm audit reported a problem (or could not reach the registry)'];
});

console.log(
  failures.length
    ? `\nDAILY CHECK FAILED (${failures.join('; ')}). Don't use ILMPDF for real documents until this is fixed.`
    : '\nDaily check passed. Start ILMPDF with npm run preview and look for the green badges.',
);
process.exitCode = failures.length ? 1 : 0;
