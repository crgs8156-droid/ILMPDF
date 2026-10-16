# Annotate PDF tool (Phase 3)

Date: 2026-10-16

## What it does

Adds text boxes, highlights, rectangles, lines and comments (sticky notes) to
pages. Items can be selected, moved, recoloured, edited (text and comments)
and deleted before saving.

## How it works

- **Engine:** MuPDF (`annotate()` in `src/engines/mupdf-ops.ts`), run in a fresh
  MuPDF worker per job. No new dependency.
- **Real annotations:** items are saved as standard PDF annotations
  (FreeText, Highlight, Square, Line, Text), not drawn into the page. Mac
  Preview and Acrobat can still move, edit or delete them.
- **Positions:** the editor stores positions as fractions of the page as shown
  on screen. MuPDF takes annotation positions in that same on-screen space
  (rotation applied, origin at the top-left of the visible area), so rotated
  and cropped pages need no extra maths. MuPDF also draws text upright on
  rotated pages.
- **Preview:** an SVG overlay (and positioned text boxes, styled through CSSOM)
  sits on top of the PDF.js page render. No inline styles, so the production
  CSP is unchanged.

## Safety and privacy

- Text is cleaned with `cleanText()` (control characters and hidden
  direction marks removed) and capped at 5,000 characters per item.
- At most 500 annotations per job (`MAX_ANNOTATIONS` in `src/core/limits.ts`);
  page numbers and positions are checked and clamped in the worker.
- No author name is written into the annotations.
- Password-protected PDFs must be unlocked first.

## Limits

- Text boxes use Helvetica. MuPDF substitutes fonts for many other scripts
  (for example Chinese), but some (such as Arabic) may not show.
- Text that does not fit its box is cut off, in the preview and in the PDF.
- Not included: freehand drawing, arrows, and editing annotations that were
  already in the PDF.
