<script lang="ts">
  import type { PdfFile } from '../core/files';
  import { formatBytes } from '../core/validate';

  type Props = { file: PdfFile; onClear: () => void };
  let { file, onClear }: Props = $props();
</script>

<div class="head" data-testid="loaded-file">
  <span class="thumb" aria-hidden="true">PDF</span>
  <div class="meta">
    <span class="name">{file.name}</span>
    <span class="detail">{file.pages} page{file.pages === 1 ? '' : 's'} · {formatBytes(file.size)}</span>
  </div>
  <button type="button" class="quiet" onclick={onClear}>Choose another file</button>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .thumb {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 46px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    font-size: 9px;
    font-weight: 700;
    color: var(--bad);
  }
  .meta {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    color: var(--muted);
    font-size: 13px;
  }
</style>
