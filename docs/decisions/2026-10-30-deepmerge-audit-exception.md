# Audit exception: deepmerge GHSA-gcqx-w48m-w2h4

Date: 2026-10-30. Approved by the owner ("Allow only this advisory", with a
30-day expiry and this record). Expires: **2026-11-29**.

## The advisory

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
low severity: `deepmerge` `mergeObject()` allows prototype poisoning of the
objects it returns when it merges crafted input. Affects `deepmerge` 4.2.0
and later; no fixed version exists.

## Why it is allowed

- The only user is `@sveltejs/vite-plugin-svelte` 7.3.1 (the newest
  release), which merges its own build options with it. It runs only during
  `npm run build` and the dev server, never on PDFs or any user input.
- It is not in `dist/`: the app that runs in Safari never contains it.
- The other options were worse: no fixed release exists to upgrade to, and
  forcing a substitute package into Svelte's tooling could change how the
  build behaves for no real security gain.

## How it is enforced

`npm run audit:deps` now runs `scripts/audit-check.mjs` instead of
`npm audit --audit-level=low`. It still fails on every advisory of any
severity, except this one advisory in this one package. The exception stops
working, and CI fails again, when:

- it expires on 2026-11-29 (the owner reviews it again), or
- a fix becomes available (update, then remove the exception), or
- the advisory is no longer reported (remove the exception).
