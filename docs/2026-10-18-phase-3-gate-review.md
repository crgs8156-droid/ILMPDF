# Phase 3 gate review

Date: 2026-10-18. Reviewed: `main` at d20a49e, which has all of Phase 3:
Annotate (PRs #14 and #19), Redact (#15 and #18), Remove scripts (#16) and the
"Also remove scripts" option in every tool that saves a PDF (#17).

## Result

**Passed on my side, with two redaction gaps to fix first.** Nothing sends data
off the device, and no rule in CLAUDE.md is broken. I tested redaction against
some tricky files and found two places where a copy of the redacted text can
survive (Findings 1 and 2). Both are small fixes in one file. I'd fix them in
one small PR before you test, the way PR #13 followed the Phase 2 gate. The
gate is complete once that fix is merged and you have worked through the
checklist below.

## What I checked

| Rule (CLAUDE.md) | Result |
| --- | --- |
| 1. Zero egress | Passed. Phase 3 added no `fetch`, XHR, WebSocket or remote resource. The only `fetch` calls are still the offline self-check and PDF.js's in-memory data loader. |
| 2. Security headers | Unchanged since Phase 2: `security-headers.ts` was not touched in Phase 3. |
| 3. Dependencies | No new dependency in Phase 3 (`package.json` unchanged). `npm audit` finds 0 vulnerabilities. The signature check passes in CI. It couldn't download here, which is a limit of this cloud machine. |
| 4. Install scripts | `.npmrc` still has `ignore-scripts=true`. |
| 5. No eval or HTML injection | No `innerHTML`, `{@html}`, `eval` or `new Function`. Annotate, Redact and Freehand set positions through CSSOM (`node.style.left`) and SVG attributes, which the CSP allows. Attached-file names and annotation text appear only through normal Svelte text. |
| 6. Untrusted input | Annotate, Find text, Redact and Remove scripts each run in a fresh MuPDF worker. Scripts are switched off (`disableJS`) before any edit. Every loop over PDF structures has a limit: bookmarks (10,000), attached files (1,000), nesting depth (64), loops in bookmark lists, ink points (2,000), annotations (500) and redaction boxes (10,000). Annotation text is cleaned of control characters and hidden direction marks. |
| 7. Memory hygiene | Nothing is stored. The "Also remove scripts" option runs one worker per file, one after another, and each is terminated after its job. |
| 8. Loopback only | Unchanged: servers bind to `127.0.0.1`. |
| 9. Test files | Tests use generated files only (test files 19, 20 and 21 were added). No PDF is committed. |
| 10. Instructions in content | Nothing reads instructions from PDFs. |

**Redaction** deletes text, image pixels and shapes under each box. It does not
just cover them. I confirmed each of these with a test file:

- Old versions of the file (incremental saves) are dropped, because the saved file is fully rewritten.
- Text in a hidden layer under a box is removed too.
- A drawing shared by two pages is redacted only on the page you marked.
- A comment under a box goes, along with its pop-up note.
- Form fields under a box are removed everywhere they appear.
- Bookmarks and attached files that mention the redacted text are removed.
- The title and author are removed while the "hidden details" box is ticked, which is the default.
- After saving, the file is opened again and checked. If anything is left under a box, the tool refuses to save.

**Remove scripts** removes JavaScript wherever it sits: in the document, in
on-open actions, in field scripts, behind `javascript:` links (any spelling)
and inside media actions. It also removes launch, remote-file and submit
actions, XFA forms and attached files. Web links and links within the
document stay.

**Annotate upgrades (#19)**: arrows are standard line annotations with an
arrowhead, and freehand drawings are standard ink annotations, so Preview can
still edit them. Each stroke is capped at 2,000 points, both on screen and in
the engine.

Tests on d20a49e: the type check is clean, and 116 unit tests and 56 browser
tests pass in Chromium. CI on `main` runs the same tests in WebKit (Safari's
engine) as well.

## Findings

### To fix before you test (one small PR)

1. **Page thumbnails survive redaction.** Some PDFs carry a small picture of
   each page (`/Thumb`), made by older Acrobat versions and some scanners.
   Redaction doesn't touch these pictures, so the thumbnail can still show
   the redacted text as an image. **Fix:** remove the thumbnail from every
   redacted page. Viewers make their own thumbnails, so nothing visible is lost.
2. **Comments elsewhere that mention the redacted text are kept.** Bookmarks
   and attached files that mention the redacted words are removed, but a
   sticky note or text box somewhere else on the page is kept, for example
   one that says "account 0000 1111…". **Fix:** apply the same rule to
   comments. Any comment whose text mentions the redacted words is removed,
   and the after-save check confirms that none are left.

### Notes (none blocking)

3. **Unticking "hidden details" keeps the title.** If you untick it, a title
   such as "Letter to Jane Example" stays in the file. That is what the box
   says, but the tool could warn when the title mentions the redacted text.
4. **Remove scripts keeps non-web links.** Links such as `file:///…` or
   `smb://…` are kept, because they are not scripts. Safari asks before
   opening them, so the risk on a Mac is low. A later option could remove
   every link that isn't `http`, `https` or `mailto`.
5. **Attached-file names in the "Kept …" warning are shown as written.** They
   appear as plain text, so this is safe, but they aren't cleaned of hidden
   direction marks the way PDF text is. A strange name could display
   reversed. This is a one-line fix and can ride along with the PR above.
6. **Very short words aren't used to find bookmarks.** Words under a drawn box
   that are shorter than three letters (such as "Jo") aren't used to match
   bookmarks and attached files, because they would match almost everything.
   Searched phrases of three characters or more are matched as usual.

## Your Mac checklist

Do this after the fix PR is merged. Setup, in Terminal:

```
cd ~/Developer/ilmpdf
git checkout main
git pull
npm ci
npm run make-test-pdfs
npm run build
npm run preview
```

Open http://127.0.0.1:4173 in Safari, **turn Wi-Fi off** and reload. The test
files are in `~/Developer/ilmpdf/test-pdfs/`.

| Tool | Try | You should see |
| --- | --- | --- |
| Annotate | `02-five-pages.pdf`: add a text box, highlight, rectangle, line, arrow, freehand drawing and comment; move one, resize one with its handles, delete one; save | `-annotated.pdf` in Preview shows every item. In Preview you can still select, move and delete them (Tools > Show Markup Toolbar). |
| Annotate | `07-rotated-pages.pdf`: add a text box and an arrow on a rotated page | Both appear upright, exactly where you placed them |
| Redact | `19-redaction-sample.pdf`: find the account number, check the marks, draw one box over the photo, redact | `-redacted.pdf` shows black boxes. In Preview, Edit > Find for the account number finds nothing, and you can't select or copy text under the boxes. |
| Redact | Same file: look at the sidebar (bookmarks) and attachments of the result | The bookmarks and attached files that mentioned the redacted text are gone. The others are still there. The result message says how many were removed. |
| Redact | Same file: redact the form field area | The field is gone on both pages, not just where you marked it |
| Redact | Same file with "hidden details" ticked, then File > Get Info (⌘I) in Preview on the result | No title, author or subject |
| Remove scripts | `20-with-scripts.pdf` | A list of what was removed (scripts, on-open action, launch action, `javascript:` link, attached file). The saved copy still has its web link and page link working. |
| Remove scripts | `01-one-page.pdf` | "Nothing to remove", and nothing is saved |
| Remove scripts | `21-form-with-scripts.pdf`, then open the result in Fill forms | The fields still fill in, and there is no Send button action |
| Also remove scripts | Watermark `20-with-scripts.pdf` with the box ticked; then again with it unticked | Ticked: the message says what was removed. Unticked: the file keeps its scripts (it's off by default). |
| Also remove scripts | Protect `20-with-scripts.pdf` with the box ticked | Saved with a password, and scripts were removed first |
| Any tool | `13-<img src=x onerror=alert(1)>.pdf` in Annotate and Redact | The name shows as plain text, with no pop-up |

Then try Annotate and Redact on a few of your own files. Those files stay on
your Mac, and Claude never sees them. Always open a redacted file and check it
before you share it.

## Next

Once the fix PR is merged and the checklist passes, tell me, and Phase 4
step 1 (Compare PDFs) can start when you say "start step 1".
