<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import RemoveScriptsOption from '../lib/RemoveScriptsOption.svelte';
  import type { PdfFile } from '../core/files';
  import { parsePageGroups } from '../core/page-spec';
  import { copyBytes, runOcrJob } from '../core/orchestrator';
  import { cleanIf } from '../core/clean';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';

  let spec = $state('');
  let skipText = $state(true);
  let alsoClean = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  let stopper: AbortController | null = null;
  const job = new ToolRun();

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  function read(file: PdfFile) {
    job.run(async () => {
      const parsed = spec.trim() ? parsePageGroups(spec, file.pages) : { ok: true as const, groups: [] };
      if (!parsed.ok) throw new Error(parsed.error);
      const pages = [...new Set(parsed.groups.flat())];
      stopper = new AbortController();
      progress = { done: 0, total: pages.length || file.pages };
      try {
        const out = await runOcrJob(
          { op: 'ocr', file: copyBytes(file.bytes), pages, skipText },
          { onProgress: (done, total) => (progress = { done, total }), signal: stopper.signal },
        );
        const pagesRead = Number(out.meta?.read ?? 0);
        const skipped = Number(out.meta?.skipped ?? 0);
        const words = out.count ?? 0;
        if (pagesRead === 0) return 'Every page already has text, so there was nothing to read. Nothing was saved.';
        if (words === 0) {
          return `No words were recognised on ${plural(pagesRead, 'page')}. They may be photos or drawings rather than text. Nothing was saved.`;
        }
        const { files: [saved], note } = await cleanIf(alsoClean, out.files!);
        saveBytes(saved!, safeFileName(file.name, '-ocr'));
        const skip = skipped ? ` Left ${plural(skipped, 'page')} that already had text as they were.` : '';
        return `Made ${plural(pagesRead, 'page')} searchable (${plural(words, 'word')} recognised) and saved a copy.${skip}${note}`;
      } finally {
        progress = null;
        stopper = null;
      }
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <div class="panel">
      <p class="muted">
        Reads the words in scanned pages and adds them as invisible text, so you can search, select and copy them. The
        pages look exactly the same. English only for now; very small or blurry print may come out with mistakes.
      </p>
      <div class="fields">
        <label class="field">Pages (blank = all)
          <input type="text" bind:value={spec} placeholder={`e.g. 1-${Math.min(3, file.pages)}`} data-testid="ocr-pages" />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={skipText} data-testid="ocr-skip-text" />
        Skip pages that already have text
      </label>
      <RemoveScriptsOption bind:checked={alsoClean} />
      <div class="actions">
        <button type="button" disabled={job.busy} onclick={() => read(file)} data-testid="run">
          {job.busy ? 'Reading…' : 'Make searchable'}
        </button>
        {#if job.busy}
          <button type="button" class="quiet" onclick={() => stopper?.abort()} data-testid="ocr-cancel">Cancel</button>
        {/if}
      </div>
      {#if progress}
        <div class="progress" data-testid="ocr-progress">
          <progress value={progress.done} max={progress.total}></progress>
          <span class="muted">
            {progress.done < progress.total ? `Reading page ${progress.done + 1} of ${progress.total}…` : 'Saving…'}
          </span>
        </div>
      {/if}
    </div>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>

<style>
  .progress {
    display: grid;
    gap: 4px;
  }
  progress {
    width: 100%;
  }
</style>
