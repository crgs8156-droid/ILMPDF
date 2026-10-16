// Hard limits that keep a single job from exhausting memory on a 16 GB Mac.
// Safari is stricter than Chrome about WebAssembly memory, so stay conservative.
export const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB per file
export const MAX_FILES = 50;
export const MAX_PAGES = 5000;
export const JOB_TIMEOUT_MS = 300_000; // 5 minutes for large merges
export const MAX_ANNOTATIONS = 500; // per Annotate job
