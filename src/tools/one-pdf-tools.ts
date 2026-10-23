// The tools that take one PDF through lib/SinglePdf.svelte, so a file from
// Your files can be opened straight in them ("Open in…"). A unit test checks
// this list against the tools' source, so it can't drift.
export const ONE_PDF_TOOLS: readonly string[] = [
  'split', 'organize', 'page-tools', 'bookmarks', 'pdf-to-images', 'pdf-to-text', 'ocr', 'extract-images',
  'crop', 'page-numbers', 'header-footer', 'watermark', 'annotate', 'sign', 'forms', 'recolor',
  'protect', 'compress', 'redact', 'metadata',
];
