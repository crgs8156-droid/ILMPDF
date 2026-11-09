// Proves scripts/security-check.mjs really catches what it claims to: each
// test plants one problem in a throwaway git repo and checks the report.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../scripts/security-check.mjs');
const dirs: string[] = [];

type Lock = { lockfileVersion: number; packages: Record<string, Record<string, unknown>> };

function goodLock(): Lock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/pdf-lib': {
        version: '1.17.1',
        resolved: 'https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz',
        integrity: 'sha512-abc',
      },
    },
  };
}

// Builds a small repo that passes every check except the vendored-file one
// (those files are big and real), then applies the given changes.
function makeRepo(files: Record<string, string | Uint8Array> = {}, lock: Lock = goodLock()): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ilmpdf-seccheck-'));
  dirs.push(dir);
  const base: Record<string, string | Uint8Array> = {
    'package.json': JSON.stringify({ dependencies: { 'pdf-lib': '1.17.1' } }),
    'package-lock.json': JSON.stringify(lock),
    '.npmrc': 'ignore-scripts=true\nsave-exact=true\n',
    'scripts/approved-packages.txt': '# approved\npdf-lib@1.17.1\n',
    'src/ok.ts': 'export const x = 1;\n',
    ...files,
  };
  for (const [name, body] of Object.entries(base)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A', '-f'], { cwd: dir });
  return dir;
}

// Commits everything staged, so the history check has commits to read.
function commit(dir: string, message: string): void {
  execFileSync('git', ['add', '-A', '-f'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', message], { cwd: dir });
}

const SHA = 'a'.repeat(40);
const goodWorkflow = [
  'on:',
  '  pull_request:',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  verify:',
  '    steps:',
  `      - uses: actions/checkout@${SHA} # v7`,
  `      - uses: actions/setup-node@${SHA}`,
  `      - uses: actions/cache@${SHA}`,
  '      - run: npm ci',
].join('\n');

function run(dir: string, ...extra: string[]): { out: string; code: number } {
  try {
    return { out: execFileSync('node', [SCRIPT, '--root', dir, ...extra], { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    const err = e as { stdout: string; status: number };
    return { out: err.stdout, code: err.status };
  }
}

// The report line for one check, e.g. "FAIL  No secrets in tracked files".
function status(out: string, check: string): 'ok' | 'FAIL' {
  const line = out.split('\n').find((l) => l.includes(check));
  if (!line) throw new Error(`check "${check}" not in output:\n${out}`);
  return line.startsWith('FAIL') ? 'FAIL' : 'ok';
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('security-check', () => {
  it('passes a clean repo (all checks but the vendored files)', () => {
    const { out } = run(makeRepo());
    for (const check of ['Lockfile sources', 'approved package list', 'exact versions', '.npmrc', 'banned code', 'zero egress', 'No PDF', 'No secrets']) {
      expect(status(out, check)).toBe('ok');
    }
    expect(status(out, 'Vendored files')).toBe('FAIL');
  });

  it('fails on raw HTML, eval, storage and inline styles', () => {
    for (const [file, code] of [
      ['src/a.ts', 'el.innerHTML = name;'],
      ['src/b.ts', 'eval(text);'],
      ['src/c.ts', 'localStorage.setItem("doc", d);'],
      ['src/D.svelte', '<p>{@html title}</p>'],
      ['src/E.svelte', '<div style="left: 4px"></div>'],
    ]) {
      const { out, code: exit } = run(makeRepo({ [file as string]: code as string }));
      expect(status(out, 'banned code'), file).toBe('FAIL');
      expect(exit).toBe(1);
    }
  });

  it('fails on network calls and web addresses, but allows the listed ones', () => {
    for (const code of ["fetch('https://example.com/x');", 'new WebSocket(url);', 'navigator.sendBeacon(u, d);', "const u = 'https://example.com/a';", 'await import(url);']) {
      expect(status(run(makeRepo({ 'src/net.ts': code })).out, 'zero egress'), code).toBe('FAIL');
    }
    const allowed = makeRepo({ 'src/core/security-status.ts': "    await fetch('/__ilmpdf_network_probe', { cache: 'no-store' });\n" });
    expect(status(run(allowed).out, 'zero egress')).toBe('ok');
    // The same text in another file is not allowed.
    const moved = makeRepo({ 'src/other.ts': "    await fetch('/__ilmpdf_network_probe', { cache: 'no-store' });\n" });
    expect(status(run(moved).out, 'zero egress')).toBe('FAIL');
  });

  it('fails on non-registry sources, missing hashes and install scripts', () => {
    const cases: Array<Record<string, unknown>> = [
      { resolved: 'git+https://github.com/someone/pdf-lib.git' },
      { integrity: undefined },
      { integrity: 'sha1-abc' },
      { hasInstallScript: true },
    ];
    for (const change of cases) {
      const lock = goodLock();
      Object.assign(lock.packages['node_modules/pdf-lib']!, change);
      expect(status(run(makeRepo({}, lock)).out, 'Lockfile sources'), JSON.stringify(change)).toBe('FAIL');
    }
  });

  it('fails when a package is not on the approved list', () => {
    const lock = goodLock();
    lock.packages['node_modules/left-pad'] = {
      version: '1.3.0',
      resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
      integrity: 'sha512-xyz',
    };
    const { out } = run(makeRepo({}, lock));
    expect(status(out, 'approved package list')).toBe('FAIL');
    expect(out).toContain('not approved: left-pad@1.3.0');
  });

  it('fails on loose versions, install hooks and a weakened .npmrc', () => {
    expect(status(run(makeRepo({ 'package.json': JSON.stringify({ dependencies: { 'pdf-lib': '^1.17.1' } }) })).out, 'exact versions')).toBe('FAIL');
    expect(status(run(makeRepo({ 'package.json': JSON.stringify({ scripts: { postinstall: 'node x.js' } }) })).out, 'exact versions')).toBe('FAIL');
    expect(status(run(makeRepo({ '.npmrc': 'save-exact=true\n' })).out, '.npmrc')).toBe('FAIL');
    expect(status(run(makeRepo({ '.npmrc': 'ignore-scripts=true\nsave-exact=true\nregistry=https://example.com/\n' })).out, '.npmrc')).toBe('FAIL');
  });

  it('fails on a committed PDF, even under another name', () => {
    expect(status(run(makeRepo({ 'docs/a.pdf': '%PDF-1.7\n' })).out, 'No PDF')).toBe('FAIL');
    expect(status(run(makeRepo({ 'docs/notes.txt': '%PDF-1.7\n%binary' })).out, 'No PDF')).toBe('FAIL');
  });

  it('fails on a secret in a tracked file', () => {
    const token = 'gh' + 'p_' + 'A1b2C3d4'.repeat(5);
    expect(status(run(makeRepo({ 'notes.md': `token ${token}\n` })).out, 'No secrets')).toBe('FAIL');
  });

  it('checks the built app for source maps, odd files and remote scripts', () => {
    const good = makeRepo({
      'dist/index.html': '<script type="module" src="/assets/index.js"></script>',
      'dist/assets/index.js': 'console.info(1);',
    });
    expect(status(run(good, '--dist-only').out, 'dist/')).toBe('ok');
    for (const [file, body] of [
      ['dist/assets/index.js.map', '{}'],
      ['dist/assets/x.js', 'a();\n//# sourceMappingURL=x.js.map'],
      ['dist/index.html', '<script src="https://cdn.example.com/x.js"></script>'],
      ['dist/index.html', '<script>alert(1)</script>'],
      ['dist/test-pdfs/a.js', ''],
    ]) {
      const dir = makeRepo({ 'dist/index.html': '<p></p>', [file as string]: body as string });
      expect(status(run(dir, '--dist-only').out, 'dist/'), file).toBe('FAIL');
    }
  });

  it('checks that CI workflows give an outside pull request no rights', () => {
    const ok = makeRepo({ '.github/workflows/ci.yml': goodWorkflow });
    expect(status(run(ok).out, 'CI workflows')).toBe('ok');
    for (const [bad, why] of [
      [goodWorkflow.replace('pull_request:', 'pull_request_target:'), 'pull_request_target'],
      [goodWorkflow.replace('on:', 'on:\n  workflow_run:'), 'workflow_run'],
      [goodWorkflow.replace('contents: read', 'contents: write'), 'write permission'],
      [goodWorkflow.replace('permissions:\n  contents: read\n', ''), 'no permissions'],
      [goodWorkflow + '\n        env:\n          T: ${{ secrets.NPM_TOKEN }}', 'secret'],
      [goodWorkflow.replace(`actions/cache@${SHA}`, 'actions/cache@v4'), 'tag instead of SHA'],
      [goodWorkflow.replace(`actions/cache@${SHA}`, `someone/action@${SHA}`), 'unknown action'],
    ]) {
      const dir = makeRepo({ '.github/workflows/ci.yml': bad as string });
      expect(status(run(dir).out, 'CI workflows'), why as string).toBe('FAIL');
    }
  });

  it('finds a PDF, a key file, a secret or a home-folder path deleted from the files but still in history', () => {
    const clean = makeRepo();
    commit(clean, 'start');
    expect(status(run(clean, '--history').out, 'git history')).toBe('ok');

    const token = 'gh' + 'p_' + 'A1b2C3d4'.repeat(5);
    const home = '/Us' + 'ers/alice/Documents/';
    for (const [file, body, expected] of [
      ['old/statement.pdf', '%PDF-1.7\n', 'is a PDF file'],
      ['notes/scan.bin', '%PDF-1.7\n%binary', 'contains a PDF header'],
      ['config/.env', 'A=1\n', 'key or secrets file'],
      ['notes.md', `token ${token}\n`, 'looks like a secret'],
      ['notes.md', `see ${home}tax.txt\n`, 'home-folder path'],
    ]) {
      const dir = makeRepo();
      commit(dir, 'start');
      mkdirSync(path.dirname(path.join(dir, file as string)), { recursive: true });
      writeFileSync(path.join(dir, file as string), body as string);
      commit(dir, 'add');
      rmSync(path.join(dir, file as string));
      commit(dir, 'remove again');
      const { out, code } = run(dir, '--history');
      expect(status(out, 'git history'), file as string).toBe('FAIL');
      expect(out, file as string).toContain(expected as string);
      expect(out, file as string).toMatch(/added in commit [0-9a-f]{7}/);
      expect(code).toBe(1);
      // Today's files are clean, so the normal checks pass.
      expect(status(run(dir).out, 'No secrets')).toBe('ok');
    }
  });

  it('refuses to call a shallow clone clean', () => {
    const dir = makeRepo();
    commit(dir, 'one');
    commit(dir, 'two');
    const shallow = mkdtempSync(path.join(tmpdir(), 'ilmpdf-shallow-'));
    dirs.push(shallow);
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, shallow]);
    const { out } = run(shallow, '--history');
    expect(status(out, 'git history')).toBe('FAIL');
    expect(out).toContain('shallow clone');
  });
});
