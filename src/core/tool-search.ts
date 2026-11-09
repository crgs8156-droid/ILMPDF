// Tool search for the sidebar field and the ⌘K box (lib/CommandPalette.svelte).
// Pure functions only: no page, no storage, no network. The text you type is
// matched against each tool's name, a short list of everyday words below,
// its group and its description, ignoring capitals and accents.

/** The parts of a tool that search looks at (a subset of registry.ts's Tool). */
export type Searchable = { id: string; name: string; blurb: string; group: string };

/**
 * Extra words people use for each tool, keyed by the tool id in
 * tools/registry.ts. tests/unit/tool-search.test.ts checks that every tool
 * has an entry and that there are no leftovers.
 */
export const TOOL_KEYWORDS: Record<string, string> = {
  merge: 'join combine append together',
  split: 'cut separate divide break extract',
  batch: 'many multiple bulk several zip',
  organize: 'reorder rotate delete move sort arrange remove',
  'page-tools': 'resize a4 letter insert blank add size',
  bookmarks: 'outline contents chapters toc',
  compare: 'diff difference changes versions',
  'images-to-pdf': 'jpg jpeg png heic webp photo picture image scan',
  'pdf-to-images': 'jpg jpeg png photo picture image export',
  'pdf-to-text': 'txt copy extract words plain',
  ocr: 'scan scanned recognise recognize searchable text',
  'extract-images': 'photo picture jpg png save',
  crop: 'trim margins cut edges',
  'page-numbers': 'numbering paginate count',
  'header-footer': 'bates date stamp',
  watermark: 'stamp confidential draft',
  annotate: 'comment highlight note draw markup shapes',
  sign: 'signature initials',
  forms: 'fill fields',
  flatten: 'bake lock fields',
  recolor: 'greyscale grayscale black white invert dark print',
  protect: 'password encrypt lock secure',
  unlock: 'password decrypt open',
  compress: 'smaller shrink reduce size optimise optimize',
  repair: 'fix broken damaged corrupt',
  redact: 'black out hide censor private',
  metadata: 'author title properties info hidden',
  'remove-scripts': 'javascript sanitise sanitize clean safe actions attachments',
};

/** Lower case, accents removed, anything that isn't a letter or digit becomes a space. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(text: string): string[] {
  const f = fold(text);
  return f ? f.split(' ') : [];
}

// How much each kind of match is worth. Every word you type must match
// somewhere, and the best place it matches counts.
const NAME_WORD = 60;
const KEYWORD = 40;
const GROUP = 25;
const BLURB = 15;
const NAME_PREFIX_BONUS = 100;

/**
 * The tools that match `query`, best first. Ties keep the registry order.
 * An empty query gives an empty list.
 */
export function searchTools<T extends Searchable>(tools: readonly T[], query: string): T[] {
  const typed = words(query);
  if (typed.length === 0) return [];
  const whole = typed.join(' ');

  const scored: { tool: T; score: number; order: number }[] = [];
  tools.forEach((tool, order) => {
    const name = words(tool.name);
    const keys = words(TOOL_KEYWORDS[tool.id] ?? '');
    const group = words(tool.group);
    const blurb = words(tool.blurb);
    let score = 0;
    for (const w of typed) {
      const starts = (list: string[]) => list.some((x) => x.startsWith(w));
      const best = starts(name) ? NAME_WORD : starts(keys) ? KEYWORD : starts(group) ? GROUP : starts(blurb) ? BLURB : 0;
      if (best === 0) return; // one typed word matches nothing: not this tool
      score += best;
    }
    if (name.join(' ').startsWith(whole)) score += NAME_PREFIX_BONUS;
    scored.push({ tool, score, order });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.tool);
}
