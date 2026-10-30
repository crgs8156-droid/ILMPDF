<script lang="ts">
  // Recent files, Your files and Saved files: three views of the memory-only
  // file shelf (core/shelf.svelte.ts).
  import FileRow from './FileRow.svelte';
  import OpenIn from './OpenIn.svelte';
  import RecentList from './RecentList.svelte';
  import Notice from '../lib/Notice.svelte';
  import { shelf } from '../core/shelf.svelte';
  import { download } from '../core/save';
  import { timeAgo } from '../core/shelf-rules';
  import { formatBytes } from '../core/validate';
  import { PAGES, type PageId } from '../core/router';
  import { TOOLS } from '../tools/registry';
  import { useClock } from './Clock.svelte';

  type Props = { page: PageId; heading?: HTMLElement | undefined };
  let { page, heading = $bindable() }: Props = $props();
  const clock = useClock();
  const toolName = (id: string | null) => TOOLS.find((t) => t.id === id)?.name ?? 'ILMPDF';
  const INTRO: Record<PageId, string> = {
    recent: 'What you opened in this tab, newest first. Carry on in the same tool, or open the file in another one.',
    files: 'Every PDF you added in this tab, ready to use in any tool without choosing it again.',
    saved: 'Every result ILMPDF saved in this tab. The real copies are in your Downloads folder.',
  };
</script>

<section class="filespage" data-testid="page-{page}">
  <div class="hero">
    <h1 bind:this={heading} tabindex="-1">{PAGES[page]}</h1>
    <p>{INTRO[page]}</p>
  </div>

  {#if page === 'recent'}
    <RecentList />
  {:else if page === 'files'}
    {#if shelf.files.length === 0}
      <p class="blank">No files yet. Drop a PDF on any tool and it shows up here.</p>
    {:else}
      <ul class="rows" data-testid="files-list">
        {#each shelf.files as f (f.id)}
          <FileRow name={f.name} detail="{f.pages} page{f.pages === 1 ? '' : 's'} · {formatBytes(f.size)} · added {timeAgo(f.added, clock.now)}">
            {#snippet actions()}
              <OpenIn fileId={f.id} name={f.name} />
              <button type="button" class="quiet" onclick={() => shelf.removeFile(f.id)} data-testid="remove-file">Remove</button>
            {/snippet}
          </FileRow>
        {/each}
      </ul>
    {/if}
  {:else if shelf.saved.length === 0}
    <p class="blank">Nothing saved yet. Results from any tool show up here.</p>
  {:else}
    <ul class="rows" data-testid="saved-list">
      {#each shelf.saved as s (s.id)}
        <FileRow name={s.name} kind="out" detail="From {toolName(s.tool)} · {formatBytes(s.size)} · {timeAgo(s.at, clock.now)}">
          {#snippet actions()}
            <button type="button" onclick={() => download(s.blob, s.name)} data-testid="save-again">Save again</button>
            <button type="button" class="quiet" onclick={() => shelf.removeSaved(s.id)} data-testid="remove-saved">Remove</button>
          {/snippet}
        </FileRow>
      {/each}
    </ul>
  {/if}

  <Notice kind="info" messages={['Kept in memory only, never on the disk. Closing or reloading this tab forgets the list, and so does “Clear all files” in the menu. Your original files are never changed.']} />
</section>

<style>
  .filespage {
    display: grid;
    gap: 18px;
  }
  .hero h1 {
    margin: 0;
    font-size: 28px;
    line-height: 1.15;
  }
  .hero p {
    margin: 6px 0 0;
    max-width: 62ch;
    color: var(--muted);
  }
  h1[tabindex='-1']:focus {
    outline: none;
  }
</style>
