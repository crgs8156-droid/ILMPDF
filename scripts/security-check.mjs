// ILMPDF security check: static checks that run on every PR (inside
// `npm run verify`) and before daily use (`npm run security:daily`).
// It reads files only. It never installs, downloads or runs package code.
//
//   node scripts/security-check.mjs                  source, lockfile, repo checks
//   node scripts/security-check.mjs --dist           also check the built dist/
//   node scripts/security-check.mjs --dist-only      only the dist/ checks (after a build)
//   node scripts/security-check.mjs --history        also scan every file version in the git
//       history (the repo is public, so old commits can be read too).
//       Needs a full clone; security:daily runs it.
//   node scripts/security-check.mjs --approve-packages
//       rewrites scripts/approved-packages.txt from package-lock.json.
//       Run it ONLY after the owner has approved a dependency change; the
//       diff of that file in the PR shows exactly which packages changed.
//   --root <dir>  check another folder (used by the unit tests)
//
// Exit code 0 = all checks passed, 1 = at least one check failed.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(args[rootArg + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_FILE = path.join(ROOT, 'scripts', 'approved-packages.txt');

// The only package allowed to carry an install script. fsevents is vite's
// optional macOS file watcher; .npmrc's ignore-scripts stops its script
// from running anyway. Any other package with one fails the check.
const INSTALL_SCRIPT_ALLOWED = new Set(['fsevents']);

// Vendored files are pinned by SHA-256. Changing one needs a new hash here,
// which shows up in review. (eng.traineddata matches vendor/tessdata/SOURCE.md.)
const VENDOR_HASHES = {
  'vendor/tessdata/eng.traineddata': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  'vendor/stubs/napi-rs-canvas/index.js': 'e7c1d298763b75d013e46d73774d659b2d571f139952732465b31704e3d506a5',
  'vendor/stubs/napi-rs-canvas/package.json': '80af32ab3eb25bfdc40994d054426d1d252861cdf3b37f33c73553dab65ec3d2',
};

// Code patterns banned in production code (CLAUDE.md rules 1, 5 and 7).
// Comments are checked too, on purpose: there is no "ignore" marker that
// could be used to sneak a pattern past this check.
const BANNED = [
  { re: /\beval\s*\(/, why: 'eval runs text as code' },
  { re: /\bnew\s+Function\s*\(/, why: 'new Function runs text as code' },
  { re: /\{@html\b/, why: '{@html} injects raw HTML' },
  { re: /\.(innerHTML|outerHTML)\b/, why: 'innerHTML/outerHTML inject raw HTML' },
  { re: /\binsertAdjacentHTML\b/, why: 'insertAdjacentHTML injects raw HTML' },
  { re: /\bdocument\.write(ln)?\s*\(/, why: 'document.write injects raw HTML' },
  { re: /\bset(Timeout|Interval)\s*\(\s*['"`]/, why: 'a string timer runs text as code' },
  { re: /\b(localStorage|sessionStorage|indexedDB)\b/, why: 'documents must stay in memory only' },
  { re: /\bcaches\.(open|match|keys|delete|has)\b/, why: 'documents must stay in memory only' },
  { re: /\bdocument\.cookie\b/, why: 'no cookies' },
  { re: /\bnavigator\.serviceWorker\b/, why: 'a service worker needs its own security review first' },
];
// Inline style attributes break the production CSP (style-src 'self').
const BANNED_SVELTE = [{ re: /\sstyle\s*=/, why: 'inline style attribute (use CSSOM in an $effect)' }];

// Network APIs (CLAUDE.md rule 1). Each allowed use is listed by file and
// the exact text on its line, so a new call anywhere fails the check.
const EGRESS = [
  { re: /\bfetch\s*\(/, name: 'fetch' },
  { re: /\bXMLHttpRequest\b/, name: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, name: 'WebSocket' },
  { re: /\bEventSource\b/, name: 'EventSource' },
  { re: /\bsendBeacon\b/, name: 'sendBeacon' },
  { re: /\bimportScripts\b/, name: 'importScripts' },
  { re: /\bRTCPeerConnection\b/, name: 'RTCPeerConnection' },
  { re: /\bWebTransport\b/, name: 'WebTransport' },
  { re: /\bimport\s*\(\s*(?!['"][^'"/:]+['"]\s*\))/, name: 'dynamic import of a non-package path' },
  { re: /(https?:)?\/\/[a-z0-9-]+(\.[a-z0-9-]+)+[/'"`\s]/i, name: 'web address' },
];
const EGRESS_ALLOWED = [
  // The in-app self-check: the CSP blocks it before any request is made.
  { file: 'src/core/security-status.ts', text: "await fetch('/__ilmpdf_network_probe'" },
  // A method named fetch on PDF.js's data factory; it reads the bundle.
  { file: 'src/engines/pdfjs.ts', text: 'async fetch({ kind, filename }' },
];

const results = [];
function report(name, problems) {
  results.push({ name, problems });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\0').filter(Boolean).filter((f) => existsSync(path.join(ROOT, f)));
  } catch {
    throw new Error(`${ROOT} is not a git repository`);
  }
}

function lines(file) {
  return readFileSync(path.join(ROOT, file), 'utf8').split('\n');
}

function packageName(key) {
  return key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

function readLock() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
}

// Registry packages in the lockfile, as sorted "name@version" lines.
function lockPackageList(lock) {
  const list = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || entry.link || entry.extraneous) continue;
    list.push(`${packageName(key)}@${entry.version}`);
  }
  return [...new Set(list)].sort();
}

// A. Lockfile: every package comes from the npm registry with a sha512
// hash, nothing runs install scripts, and the package set is the approved one.
function checkLockfile() {
  const problems = [];
  const lock = readLock();
  if (lock.lockfileVersion !== 3) problems.push(`lockfileVersion is ${lock.lockfileVersion}, expected 3`);
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || entry.extraneous) continue;
    const name = packageName(key);
    if (entry.link) {
      // Only our own local stubs may be linked in, never another folder.
      if (!String(entry.resolved).startsWith('vendor/stubs/')) problems.push(`${name} is linked to ${entry.resolved}`);
      continue;
    }
    if (!String(entry.resolved).startsWith('https://registry.npmjs.org/')) {
      problems.push(`${name} comes from ${entry.resolved ?? 'nowhere'}, not https://registry.npmjs.org/`);
    }
    if (!String(entry.integrity).startsWith('sha512-')) problems.push(`${name} has no sha512 integrity hash`);
    if (entry.hasInstallScript && !INSTALL_SCRIPT_ALLOWED.has(name)) problems.push(`${name} has an install script`);
  }
  report('Lockfile sources, hashes and install scripts', problems);

  const approved = existsSync(APPROVED_FILE)
    ? readFileSync(APPROVED_FILE, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    : [];
  const current = lockPackageList(lock);
  const added = current.filter((p) => !approved.includes(p));
  const removed = approved.filter((p) => !current.includes(p));
  report('Lockfile matches the approved package list', [
    ...added.map((p) => `not approved: ${p}`),
    ...removed.map((p) => `approved but gone (re-approve the list): ${p}`),
  ]);
}

// A. package.json pins exact versions only.
function checkExactVersions() {
  const problems = [];
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (spec.startsWith('file:vendor/stubs/')) continue;
      if (!/^\d+\.\d+\.\d+$/.test(spec)) problems.push(`${field}: ${name} is "${spec}", not an exact version`);
    }
  }
  for (const [name, spec] of Object.entries(pkg.overrides ?? {})) {
    if (spec !== `$${name}`) problems.push(`override ${name} is "${spec}"`);
  }
  if (pkg.scripts) {
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
      if (pkg.scripts[hook]) problems.push(`package.json has a "${hook}" script`);
    }
  }
  report('package.json uses exact versions and no install hooks', problems);
}

// A. .npmrc keeps install scripts off and versions exact (CLAUDE.md rule 4).
function checkNpmrc() {
  const file = path.join(ROOT, '.npmrc');
  const problems = [];
  if (!existsSync(file)) {
    problems.push('.npmrc is missing');
  } else {
    const settings = new Map();
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const [k, ...v] = line.split('=');
      settings.set(k.trim(), v.join('=').trim());
    }
    if (settings.get('ignore-scripts') !== 'true') problems.push('ignore-scripts=true is missing');
    if (settings.get('save-exact') !== 'true') problems.push('save-exact=true is missing');
    // Nothing may point npm at another registry or loosen its checks.
    for (const key of settings.keys()) {
      if (key === 'registry' || key.endsWith(':registry') || key.includes('_auth') || key === 'strict-ssl' || key === 'script-shell') {
        problems.push(`.npmrc sets ${key}`);
      }
    }
  }
  report('.npmrc keeps install scripts off', problems);
}

// A. node_modules holds exactly what the lockfile says (catches a stale or
// tampered install). Missing optional packages for other platforms are fine.
function checkInstalled() {
  const hidden = path.join(ROOT, 'node_modules', '.package-lock.json');
  if (!existsSync(hidden)) {
    report('Installed packages match the lockfile', existsSync(path.join(ROOT, 'node_modules')) ? ['node_modules has no .package-lock.json: run npm ci'] : []);
    return;
  }
  const installed = JSON.parse(readFileSync(hidden, 'utf8')).packages ?? {};
  const locked = readLock().packages ?? {};
  const problems = [];
  for (const [key, entry] of Object.entries(installed)) {
    const want = locked[key];
    if (!want) problems.push(`${key} is installed but not in package-lock.json`);
    else if (!entry.link && (entry.version !== want.version || entry.integrity !== want.integrity)) {
      problems.push(`${key} is ${entry.version}, lockfile says ${want.version} (or its hash differs)`);
    }
  }
  for (const [key, want] of Object.entries(locked)) {
    if (key.startsWith('node_modules/') && !installed[key] && !want.optional && !want.devOptional && !want.extraneous) {
      problems.push(`${key} is in the lockfile but not installed`);
    }
  }
  if (problems.length) problems.push('fix: run npm ci');
  report('Installed packages match the lockfile', problems);
}

// A. Vendored files still match their recorded SHA-256.
function checkVendor(files) {
  const problems = [];
  for (const [file, hash] of Object.entries(VENDOR_HASHES)) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) problems.push(`${file} is missing`);
    else if (sha256(full) !== hash) problems.push(`${file} changed (SHA-256 differs from the pinned value)`);
  }
  for (const file of files.filter((f) => f.startsWith('vendor/'))) {
    if (!(file in VENDOR_HASHES) && !file.endsWith('SOURCE.md')) problems.push(`${file} is vendored but has no pinned hash`);
  }
  report('Vendored files match their pinned hashes', problems);
}

// I. Banned code patterns in production code.
function checkBannedPatterns(files) {
  const problems = [];
  const prod = files.filter((f) => /^src\/.*\.(ts|js|mjs|svelte)$/.test(f) || f === 'index.html');
  for (const file of prod) {
    const rules = file.endsWith('.svelte') || file.endsWith('.html') ? [...BANNED, ...BANNED_SVELTE] : BANNED;
    lines(file).forEach((line, i) => {
      for (const { re, why } of rules) if (re.test(line)) problems.push(`${file}:${i + 1}: ${why}: ${line.trim()}`);
    });
  }
  // index.html: scripts must come from our own files, never inline or remote.
  if (files.includes('index.html')) {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
      if (!/\ssrc="\/src\//.test(tag)) problems.push(`index.html: script that is inline or not from /src/: ${tag}`);
    }
    if (/<style\b/i.test(html)) problems.push('index.html: inline <style>');
  }
  report('No banned code patterns (eval, raw HTML, storage, inline styles)', problems);
}

// B. Network calls and web addresses in our own code.
function checkEgress(files) {
  const problems = [];
  for (const file of files.filter((f) => /^src\/.*\.(ts|js|mjs|svelte)$/.test(f) || f === 'index.html')) {
    lines(file).forEach((line, i) => {
      for (const { re, name } of EGRESS) {
        if (!re.test(line)) continue;
        if (EGRESS_ALLOWED.some((a) => a.file === file && line.includes(a.text))) continue;
        problems.push(`${file}:${i + 1}: ${name}: ${line.trim()}`);
      }
    });
  }
  report('No network calls or web addresses in app code (zero egress)', problems);
}

// Rule 9. No PDF files in the repo, under any name.
// A PDF renamed to something else still has %PDF- in its first 1 KB. Our
// own code mentions the header as text, so for code files only a file that
// starts with it counts.
function hasPdfHeader(file, head) {
  const at = head.indexOf('%PDF-');
  return at === 0 || (at > 0 && !/\.(ts|mjs|js|md)$/.test(file));
}

function checkNoPdfs(files) {
  const problems = [];
  for (const file of files) {
    if (/\.pdf$/i.test(file)) {
      problems.push(`${file} is a PDF file`);
      continue;
    }
    const head = Buffer.alloc(1024);
    const fd = openSync(path.join(ROOT, file), 'r');
    const n = readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    if (hasPdfHeader(file, head.subarray(0, n))) problems.push(`${file} contains a PDF header`);
  }
  report('No PDF files committed', problems);
}

// I. Obvious secrets in tracked files (GitHub secret scanning is the backup).
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
  /\/\/registry\.npmjs\.org\/:_authToken=/,
];
const secretIn = (text) => SECRET_PATTERNS.find((re) => re.test(text));

function checkSecrets(files) {
  const problems = [];
  for (const file of files) {
    const full = path.join(ROOT, file);
    if (statSync(full).size > 2 * 1024 * 1024) continue; // models and binaries
    const re = secretIn(readFileSync(full, 'utf8'));
    if (re) problems.push(`${file}: looks like a secret (${re.source.slice(0, 24)}...)`);
  }
  report('No secrets in tracked files', problems);
}

// The repo is public, so anyone can open a pull request, and CI runs on it.
// The workflows must keep a stranger's pull request from doing anything:
// no pull_request_target or workflow_run (they run with the repo's own
// rights), no secrets, read-only permissions, and only these actions,
// pinned to a full commit SHA.
const ALLOWED_ACTIONS = new Set(['actions/checkout', 'actions/setup-node', 'actions/cache']);

function checkWorkflows(files) {
  const problems = [];
  for (const file of files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    if (/\bpull_request_target\b/.test(text)) problems.push(`${file}: uses pull_request_target`);
    if (/\bworkflow_run\b/.test(text)) problems.push(`${file}: uses workflow_run`);
    if (/\$\{\{\s*secrets\./.test(text)) problems.push(`${file}: reads a secret`);
    if (!/^permissions:/m.test(text)) problems.push(`${file}: no top-level permissions (must be contents: read)`);
    if (/\bwrite-all\b|^\s*[a-z-]+:\s*write\s*(#.*)?$/m.test(text)) problems.push(`${file}: asks for a write permission`);
    for (const [, uses] of text.matchAll(/^\s*(?:-\s*)?uses:\s*['"]?([^\s'"#]+)/gm)) {
      const [name, ref = ''] = uses.split('@');
      if (!ALLOWED_ACTIONS.has(name)) problems.push(`${file}: uses ${name}, which is not on the allowed list`);
      else if (!/^[0-9a-f]{40}$/.test(ref)) problems.push(`${file}: ${name} is not pinned to a full commit SHA`);
    }
  }
  report('CI workflows safe for outside pull requests', problems);
}

// Every version of every file ever committed, including deleted ones:
// no PDFs, key files, secrets or private home-folder paths.
const KEY_FILE = /(^|\/)(\.env(\.[^/]*)?|id_rsa|id_ed25519|[^/]*\.(pem|key|p12|pfx))$/i;
const HOME_PATH = /\/Users\/[A-Za-z][^/\s'"`]*\//;

function gitBuffer(args, input) {
  return execFileSync('git', args, { cwd: ROOT, input, maxBuffer: 1024 * 1024 * 1024 });
}

function checkHistory() {
  const problems = [];
  if (gitBuffer(['rev-parse', '--is-shallow-repository']).toString().trim() === 'true') {
    report('Whole git history is clean', ['this is a shallow clone, so old commits are missing: run it in a full clone']);
    return;
  }
  // Each line is "<id>" (a commit) or "<id> <path>" (a folder or a file).
  const where = new Map();
  for (const line of gitBuffer(['rev-list', '--all', '--objects']).toString().split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0 && !where.has(line.slice(0, space))) where.set(line.slice(0, space), line.slice(space + 1));
  }
  const types = gitBuffer(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], [...where.keys()].join('\n') + '\n');
  const blobs = [];
  for (const line of types.toString().trim().split('\n')) {
    const [id, type, size] = line.split(' ');
    if (type !== 'blob') continue;
    const file = where.get(id);
    if (/\.pdf$/i.test(file)) problems.push({ id, msg: `${file} is a PDF file` });
    else if (KEY_FILE.test(file)) problems.push({ id, msg: `${file} looks like a key or secrets file` });
    if (Number(size) <= 2 * 1024 * 1024) blobs.push(id);
  }
  // "git cat-file --batch" prints "<id> <type> <size>\n<content>\n" per object.
  const out = blobs.length ? gitBuffer(['cat-file', '--batch'], blobs.join('\n') + '\n') : Buffer.alloc(0);
  for (let pos = 0; pos < out.length; ) {
    const eol = out.indexOf(10, pos);
    const [id, , size] = out.subarray(pos, eol).toString().split(' ');
    const body = out.subarray(eol + 1, eol + 1 + Number(size));
    pos = eol + 2 + Number(size);
    const file = where.get(id);
    if (!/\.pdf$/i.test(file) && hasPdfHeader(file, body.subarray(0, 1024))) problems.push({ id, msg: `${file} contains a PDF header` });
    const text = body.toString('utf8');
    const re = secretIn(text);
    if (re) problems.push({ id, msg: `${file}: looks like a secret (${re.source.slice(0, 24)}...)` });
    if (HOME_PATH.test(text)) problems.push({ id, msg: `${file}: contains a private home-folder path (${text.match(HOME_PATH)[0]})` });
  }
  // Name the commit that added each problem, so it can be found.
  const named = problems.map(({ id, msg }) => {
    const commit = gitBuffer(['log', '--all', '--format=%h', '--find-object', id]).toString().trim().split('\n').pop();
    return `${msg} (added in commit ${commit})`;
  });
  report('Whole git history is clean', named);
}

// J. The built app: only expected file types, no source maps, no test
// files, and index.html loads only its own files.
function checkDist() {
  const dist = path.join(ROOT, 'dist');
  if (!existsSync(dist)) {
    report('Built app (dist/) contents', ['dist/ does not exist: run npm run build first']);
    return;
  }
  const problems = [];
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : [path.relative(dist, path.join(dir, d.name))],
    );
  for (const file of walk(dist)) {
    if (!/\.(js|mjs|css|html|wasm)$/.test(file)) problems.push(`dist/${file}: unexpected file type`);
    if (/test-pdfs|\.test\.|\.spec\./.test(file)) problems.push(`dist/${file}: test file in the build`);
    if (/\.(js|mjs|css)$/.test(file)) {
      const text = readFileSync(path.join(dist, file), 'utf8');
      if (/[#@] sourceMappingURL=(?!data:)/.test(text.slice(-500))) problems.push(`dist/${file}: points to a source map`);
    }
  }
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const tag of html.match(/<(script|link)\b[^>]*>/gi) ?? []) {
    const url = tag.match(/\s(?:src|href)="([^"]*)"/)?.[1];
    if (url === undefined) {
      if (/^<script/i.test(tag)) problems.push(`dist/index.html: inline script ${tag}`);
    } else if (!url.startsWith('/') || url.startsWith('//')) {
      problems.push(`dist/index.html: loads ${url}, not one of its own files`);
    }
  }
  if (/<style\b/i.test(html)) problems.push('dist/index.html: inline <style>');
  report('Built app (dist/) contents', problems);
}

function approvePackages() {
  const list = lockPackageList(readLock());
  const header = [
    '# Packages the owner has approved (generated from package-lock.json).',
    '# Regenerate ONLY after an approved dependency change:',
    '#   node scripts/security-check.mjs --approve-packages',
    '# The PR diff of this file shows exactly which packages changed.',
  ];
  writeFileSync(APPROVED_FILE, [...header, ...list, ''].join('\n'));
  console.log(`Wrote ${list.length} packages to ${path.relative(ROOT, APPROVED_FILE)}`);
}

function main() {
  if (args.includes('--approve-packages')) {
    approvePackages();
    return 0;
  }
  if (!args.includes('--dist-only')) {
    const files = trackedFiles();
    checkLockfile();
    checkExactVersions();
    checkNpmrc();
    checkInstalled();
    checkVendor(files);
    checkBannedPatterns(files);
    checkEgress(files);
    checkNoPdfs(files);
    checkSecrets(files);
    checkWorkflows(files);
  }
  if (args.includes('--history')) checkHistory();
  if (args.includes('--dist') || args.includes('--dist-only')) checkDist();

  let failed = 0;
  for (const { name, problems } of results) {
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${name}`);
    for (const p of problems) console.log(`        - ${p}`);
    if (problems.length) failed++;
  }
  console.log(failed ? `\nSecurity check FAILED: ${failed} of ${results.length} checks.` : `\nSecurity check passed: ${results.length} checks.`);
  return failed ? 1 : 0;
}

process.exitCode = main();
