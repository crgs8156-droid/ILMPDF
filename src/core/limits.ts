// Hard limits that keep a single job from exhausting memory on a 16 GB Mac.
// Safari is stricter than Chrome about WebAssembly memory, so stay conservative.
export const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB per file
export const MAX_FILES = 50;
export const MAX_PAGES = 5000;
export const JOB_TIMEOUT_MS = 300_000; // 5 minutes for large merges
export const MAX_ANNOTATIONS = 500; // per Annotate job
export const MAX_INK_POINTS = 2_000; // per freehand stroke, so a drawing can't bloat the file
// OCR reads one page at a time, so its time limit is per page, not per job.
export const OCR_PAGE_TIMEOUT_MS = 120_000;
export const MAX_IMAGES = 500; // per Extract images job
// Largest picture (width x height) PDF.js will draw in a preview or page
// image; bigger ones are left out. A hostile PDF can claim a picture of
// 100,000 x 100,000 pixels, which froze Safari's page. 100 megapixels is far
// above any real scan (an A3 page at 600 dpi is about 70 megapixels).
export const MAX_RENDER_IMAGE_PIXELS = 100_000_000;
