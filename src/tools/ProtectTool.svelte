<script lang="ts">
  import SinglePdf from '../lib/SinglePdf.svelte';
  import Notice from '../lib/Notice.svelte';
  import type { PdfFile } from '../core/files';
  import { copyBytes, runMupdfJob } from '../core/orchestrator';
  import { saveBytes } from '../core/save';
  import { safeFileName } from '../core/validate';
  import { ToolRun } from '../core/run.svelte';

  // Held only in this component's memory; cleared once the file is saved.
  let password = $state('');
  let confirm = $state('');
  let allowPrint = $state(true);
  let allowCopy = $state(true);
  let allowEdit = $state(true);
  const job = new ToolRun();

  const mismatch = $derived(confirm.length > 0 && confirm !== password);
  const short = $derived(password.length > 0 && password.length < 8);
  const ready = $derived(password.length > 0 && confirm === password);

  function protect(file: PdfFile) {
    const typed = password;
    job.run(async () => {
      const out = await runMupdfJob({
        op: 'protect',
        file: copyBytes(file.bytes),
        opts: { password: typed, allowPrint, allowCopy, allowEdit },
      });
      password = '';
      confirm = '';
      saveBytes(out.files![0]!, safeFileName(file.name, '-protected'));
      return 'Saved a password-protected copy (AES-256). Keep the password safe: it cannot be recovered.';
    });
  }
</script>

<SinglePdf>
  {#snippet children(file: PdfFile)}
    <form
      class="panel"
      onsubmit={(e) => {
        e.preventDefault();
        if (ready) protect(file);
      }}
    >
      <div class="fields">
        <label class="field">
          Password
          <input type="password" bind:value={password} autocomplete="new-password" spellcheck="false" maxlength="127" data-testid="password" />
        </label>
        <label class="field">
          Type it again
          <input type="password" bind:value={confirm} autocomplete="new-password" spellcheck="false" maxlength="127" data-testid="confirm" />
        </label>
      </div>
      {#if mismatch}<p class="warn" data-testid="mismatch">The two passwords don't match.</p>{/if}
      {#if short}<p class="muted">Tip: 8 or more characters make it much harder to guess.</p>{/if}
      <fieldset>
        <legend>People who open it may</legend>
        <label class="check"><input type="checkbox" bind:checked={allowPrint} data-testid="allow-print" /> Print</label>
        <label class="check"><input type="checkbox" bind:checked={allowCopy} data-testid="allow-copy" /> Copy text and images</label>
        <label class="check"><input type="checkbox" bind:checked={allowEdit} data-testid="allow-edit" /> Edit, comment and fill forms</label>
      </fieldset>
      <p class="muted">
        Uses AES-256 encryption. The password is the only way in, and ILMPDF never stores it. Most PDF apps respect the
        print, copy and edit settings, but they are a request, not a lock.
      </p>
      <div class="actions">
        <button type="submit" disabled={job.busy || !ready} data-testid="run">{job.busy ? 'Protecting…' : 'Protect PDF'}</button>
      </div>
    </form>
    <Notice messages={job.errors} />
    <Notice kind="ok" messages={job.done} />
  {/snippet}
</SinglePdf>

<style>
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px 12px;
    margin: 12px 0;
    display: grid;
    gap: 6px;
  }
  legend {
    color: var(--muted);
    font-size: 13px;
    padding: 0 4px;
  }
  .warn {
    color: var(--danger, #b42318);
    font-size: 14px;
    margin: 4px 0;
  }
</style>
