// Line icons, drawn as SVG paths on a 24 x 24 grid and stroked (never
// filled), in the same style as the Drag Wheel. Plain strings: nothing is
// loaded from anywhere. Shown with lib/Icon.svelte.

/** One icon per tool, keyed by the tool's id in tools/registry.ts. */
export const TOOL_ICONS: Record<string, string> = {
  merge: 'M7 4v5l5 5 5-5V4M12 14v6',
  split: 'M12 4v6l-5 5v5M12 10l5 5v5',
  batch: 'M4 8h12v12H4zM8 4h12v12',
  organize: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  'page-tools': 'M6 3h9l4 4v14H6zM15 3v4h4M10 14h6M13 11v6',
  bookmarks: 'M7 3h10v18l-5-4-5 4z',
  compare: 'M4 4h6v16H4zM14 4h6v16h-6zM10 9h4M10 15h4',
  'images-to-pdf': 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01',
  'pdf-to-images': 'M3 5h12v10H3zM3 12l4-4 3 3 2-2 3 3M19 9v11M16 17l3 3 3-3',
  'pdf-to-text': 'M5 6h14M5 10h14M5 14h10M5 18h7',
  ocr: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8',
  'extract-images': 'M4 5h10v9H4zM4 12l3-3 3 3M18 8v12M15 17l3 3 3-3',
  crop: 'M6 2v16h16M2 6h16v16',
  'page-numbers': 'M9 4L7 20M17 4l-2 16M4 9h16M3 15h16',
  'header-footer': 'M5 3h14v18H5zM5 7h14M5 17h14',
  watermark: 'M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z',
  annotate: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  sign: 'M3 17c3-6 5-8 6-6s-1 6 1 6 3-5 5-5 1 4 3 4 3-2 3-2M3 21h18',
  forms: 'M4 5h16v14H4zM8 10h8M8 14h5',
  flatten: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  recolor: 'M12 3a9 9 0 100 18a9 9 0 000-18zM12 3v18',
  protect: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 017.5-2',
  compress: 'M4 4l6 6M10 5v5H5M20 20l-6-6M14 19v-5h5',
  repair: 'M15 4a5 5 0 00-5 6l-6 6 4 4 6-6a5 5 0 006-5l-3 1-2-2z',
  redact: 'M4 9h16v6H4zM4 5h7M4 19h10',
  metadata: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  'remove-scripts': 'M9 4c-2 0-3 1-3 3v2l-2 3 2 3v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2l2 3-2 3v2c0 2-1 3-3 3',
};

/** Icons for the app itself. */
export const UI_ICONS = {
  mark: 'M7 3h7l5 5v13H7zM14 3v5h5M10 14l2 2 4-4',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  drop: 'M7 3h7l5 5v13H7zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  dragHint: 'M12 3v12M8 11l4 4 4-4M4 17v3h16v-3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  ok: 'M5 12l4 4 10-10',
  alert: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8h.01',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  folder: 'M4 6h6l2 2h8v11H4zM4 10h16',
  saved: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
} as const;

/** The CSS class that gives a tool group its colour (see app.css). */
export function groupClass(group: string): string {
  return `g-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}
