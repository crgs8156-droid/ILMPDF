# Checking a PR on your Mac

GitHub Actions has a limited number of free minutes each month. So a PR can be
merged when **either** its CI run is green **or** the full check below passes
on your Mac. Both run exactly the same suite: `npm run verify`.

## What `npm run verify` runs

In this order, stopping at the first failure:

1. `security:check`: lockfile, `.npmrc`, banned code, network calls, no PDFs, secrets
2. `check`: Svelte and TypeScript type check
3. `test`: unit tests
4. `test:fuzz`: the hostile-PDF attack files plus a short random round
5. `build`, then a security check of the built `dist/` folder
6. `test:e2e`: browser tests in **WebKit** (Safari's engine) **and Chromium**,
   against the production build, with the network watcher on every test

## One-time setup

Playwright needs its own copies of WebKit and Chromium (separate from Safari;
nothing is installed system-wide). Run this once, and again after a PR that
upgrades `@playwright/test`:

```sh
cd ~/Developer/ilmpdf
npx playwright install webkit chromium
```

## Checking a PR

Replace `BRANCH-NAME` with the PR's branch (shown at the top of the PR on GitHub).
Close any window running `npm run preview` first: the browser tests start their
own server on port 4173 and would otherwise test that older build.

```sh
cd ~/Developer/ilmpdf
git fetch origin
git checkout BRANCH-NAME
git pull
npm ci
npm run verify
```

It takes several minutes. It **passed** when it ends with a Playwright line
like `123 passed` and no `failed` line, and `echo $?` straight afterwards prints `0`.
If anything failed, copy the last 30 or so lines into the PR's thread.

Then go back to main:

```sh
git checkout main
```

## When CI runs (and when it doesn't)

To save minutes, `.github/workflows/ci.yml` runs only on pull requests that are
ready for review. It skips:

- draft PRs (it runs once the PR is marked **Ready for review**)
- PRs that change only `docs/` or `.md` files
- pushes to main after a merge (the PR already ran the same checks)

A newer push to the same PR cancels the older run. For a manual run, open the
**Actions** tab on GitHub, choose **CI**, then **Run workflow**.
