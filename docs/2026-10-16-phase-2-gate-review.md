# Phase 2 gate review

Date: 2026-10-16. Reviewed: `main` at e64fba0, which has Phase 2 steps 1 to 9 (PRs #3 to #11).

## Result

**Passed on my side.** I found no security problems that need fixing before you test. There are three small notes at the end, and none of them blocks the gate. The gate is complete once you have worked through the checklist below and done a few real jobs on your Mac.

## What I checked

| Rule (CLAUDE.md) | Result |
| --- | --- |
| 1. Zero egress | Passed. The only `fetch` calls are the app's own offline self-check (meant to be refused) and PDF.js's bundled-data loader, which reads from memory. Every browser test asserts that no request leaves the local server. |
| 2. Security headers | Unchanged since Phase 0: `connect-src 'none'`, `style-src 'self'`, COOP/COEP. All Phase 2 positioning uses CSSOM, which this CSP allows. |
| 3. Dependencies | One addition in Phase 2, `mupdf` 1.28.1, which you approved. It is pinned exactly and its `.wasm` is bundled, never fetched. `npm audit` finds 0 vulnerabilities. The registry signature check passed on `main` in CI. |
| 4. Install scripts | `.npmrc` still has `ignore-scripts=true`. |
| 5. No eval or HTML injection | No `innerHTML`, `{@html}`, `eval`, `new Function` or inline styles anywhere in `src`. File names, form labels and PDF text appear only through normal Svelte text or a read-only text box. |
| 6. Untrusted input | MuPDF and pdf-lib run only in a fresh worker per job, and PDF.js parses in its own worker. Form scripts are switched off (`disableJS`). PDF to text strips control characters and hidden text-direction marks. Workers report only fixed, plain error messages. |
| 7. Memory hygiene | Nothing is written to localStorage, IndexedDB, caches or logs. Each worker is terminated when its job ends, or after 5 minutes. Unlock and Protect clear the password field after each job, and Protect's fields are marked `new-password`. |
| 8. Loopback only | The dev and preview servers bind to `127.0.0.1`. |
| 9. Test files | No PDF is committed. Tests use generated files only, and `test-pdfs/` is git-ignored. |
| 10. Instructions in content | Nothing reads instructions from PDFs or packages. |

Limits: every tool takes files only through the size check (500 MB). The tools that walk pages (Repair, Compress, Forms, PDF to text) also refuse PDFs over 5,000 pages.

Tests: the type check is clean, 74 unit tests pass, and 37 browser tests pass in Chromium at both normal and Retina density. CI on `main` also passes in WebKit (Safari's engine).

## Your Mac checklist

Setup, in Terminal:

```
cd ~/Developer/ilmpdf
git checkout main
git pull
npm ci
npm run make-test-pdfs
npm run build
npm run preview
```

Open http://127.0.0.1:4173 in Safari, then **turn Wi-Fi off** and reload. The app should still work, and that confirms it is offline. The test files are in `~/Developer/ilmpdf/test-pdfs/`.

| Tool | Try | You should see |
| --- | --- | --- |
| Unlock PDF | `14-password-aes256-is-test.pdf` with password `wrong`, then `test` | "That password is not correct.", then `…-unlocked.pdf`, which opens in Preview without a password |
| Unlock PDF | `18-restricted-…pdf` with `owner-test` | An unlocked copy you can print |
| Protect PDF | `01-one-page.pdf` with a password of your choice | `01-one-page-protected.pdf`; Preview asks for your password |
| Repair PDF | `16-repairable.pdf` | `16-repairable-repaired.pdf` opens normally |
| Repair PDF | `11-damaged.pdf` | A clear "too damaged" message, with no crash |
| Compress PDF | `17-scanned-heavy.pdf` on Strong | "% smaller", and the saved copy is much smaller |
| Compress PDF | `01-one-page.pdf` on Light | "already compact", and nothing is saved |
| Fill forms | `15-form.pdf`: fill every field, then save; then repeat with Flatten | `-filled.pdf` can still be edited in Preview; `-flattened.pdf` has no fields left |
| Sign PDF | `02-five-pages.pdf`: draw a signature, place it, try "every page" | `-signed.pdf`, with the signature where you placed it |
| Sign PDF | `07-rotated-pages.pdf`, signing a rotated page | The signature is upright, exactly where you clicked |
| Crop pages | `06-mixed-sizes.pdf`: draw a frame, every page; then only this page | `-cropped.pdf` is trimmed to your frame |
| PDF to text | `02-five-pages.pdf` | `02-five-pages.txt` holds pages 1 to 5 in order |
| PDF to text | `17-scanned-heavy.pdf` | "No text was found…", and nothing is saved |
| Any tool | `12-not-really-a-pdf.pdf` and `13-<img src=x onerror=alert(1)>.pdf` | The first is refused; the second shows its name as plain text, with no pop-up |

Then do a few of your own everyday jobs with your real files. Those files stay on your Mac, and Claude never sees them. Note anything that feels slow, confusing or wrong.

## Notes (none blocking)

1. **Embedded scripts are kept.** Tools such as Compress, Repair and Sign keep any JavaScript or auto-open actions that were already inside a PDF, as iLovePDF does. ILMPDF never runs them, but Acrobat might. A "remove scripts and actions" option could join Phase 3 alongside redaction.
2. **Unlock and Protect have no page limit.** Unlike the page-walking tools, they don't check the 5,000-page limit. They don't loop over pages and the 500 MB size limit still applies, so the risk is low. A one-line check could be added for consistency.
3. **One out-of-date description.** In `scripts/make-test-pdfs.mjs`, the description of `10-password-is-test.pdf` still says the file should be refused "until Phase 2". It should now say Unlock opens it with the password `test`.

## Next

Once you have finished the checklist and some real jobs, tell me what you found, and I'll draft the Phase 3 plan (redaction, annotations, text boxes) for your approval.
