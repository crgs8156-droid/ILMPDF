# GitHub settings for the public ILMPDF repo

The repo became public on 2026-10-30. The app is unchanged: it still runs
only on your Mac, and your files never leave it. These settings protect the
repo itself, now that anyone can read it and open pull requests. They are all
on github.com/crgs8156-droid/ILMPDF, each takes about a minute, and Claude
can't change them for you.

## 1. GitHub Actions (from the CI update)

- [ ] **Settings > Actions > General > Actions permissions:** choose "Allow
      crgs8156-droid, and select non-crgs8156-droid, actions and reusable
      workflows", tick "Allow actions created by GitHub", and leave the
      list of other actions empty. If "Require actions to be pinned to a
      full-length commit SHA" is shown, tick it.
- [ ] **Same page > Approval for running fork pull request workflows from
      contributors:** choose **"Require approval for all external
      contributors"**. Read a stranger's PR changes before you approve it.
- [ ] **Same page > Workflow permissions:** choose **"Read repository
      contents and packages permissions"**, untick "Allow GitHub Actions to
      create and approve pull requests", then click Save.

The workflow itself already uses read-only `contents: read` permissions and
only `pull_request`, never `pull_request_target`. It has no secrets, uses only
GitHub's own SHA-pinned actions, sets `persist-credentials: false`, and
`.npmrc` keeps install scripts off.

## 2. Security alerts (free for public repos)

**Settings > Advanced Security** (sometimes called "Code security"):

- [ ] **Secret Protection** (secret scanning): on
- [ ] **Push protection**: on, so GitHub refuses a push that contains a token
- [ ] **Dependabot alerts**: on (warnings only)
- [ ] **Private vulnerability reporting**: on
- Leave Dependabot **version updates** and **security updates** off: every
  new dependency version needs your approval first (rule 3 in `CLAUDE.md`).

## 3. Protect `main`

**Settings > Rules > Rulesets > New branch ruleset:** name it `main`, set
Enforcement to **Active**, target the default branch, and tick:

- [ ] **Restrict deletions**
- [ ] **Block force pushes**

Don't tick "Require a pull request" or "Require status checks". Docs-only PRs
skip CI, so they would wait forever, and you sometimes push workflow files to
`main` from your Mac.

## 4. Keep your email address out of future commits

Your Gmail address is in 46 older commits. They are public now, and changing
them would mean rewriting history, which isn't worth it. To keep it out of
new commits:

- [ ] Your GitHub profile, **Settings > Emails**: tick **"Keep my email
      addresses private"** and **"Block command line pushes that expose my
      email"**. Note the `...@users.noreply.github.com` address shown there.
- [ ] On the Mac, use that address for this repo:

```
cd ~/Developer/ilmpdf
git config user.email "YOUR-ID+crgs8156-droid@users.noreply.github.com"
```

Replace the address with the exact one GitHub shows you.

## 5. Issues and pull requests from other people

- [ ] Optional: **Settings > General > Features**: untick **Issues** if you
      don't want strangers posting.
- Claude acts only on issues and pull requests you opened or ask about (rule
  11 in `CLAUDE.md`). Treat anyone else's like an email from a stranger.

## 6. What now runs automatically

- **Every pull request (CI):** `security:check` fails if a workflow ever uses
  `pull_request_target` or `workflow_run`, reads a secret, asks for a write
  permission, or uses an action other than SHA-pinned `actions/checkout`,
  `actions/setup-node` or `actions/cache`.
- **Before daily use (your Mac):** `npm run security:daily` also scans every
  file ever committed, including deleted ones, for PDFs, key files, tokens
  and paths from your Mac. The first full scan on 2026-10-30 found nothing.
