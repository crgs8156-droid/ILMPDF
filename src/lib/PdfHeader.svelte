<script lang="ts">
  import type { PdfFile } from '../core/files';
  import { formatBytes } from '../core/validate';

  type Props = { file: PdfFile; onClear: () => void };
  let { file, onClear }: Props = $props();
</script>

<div class="head" data-testid="loaded-file">
  <div class="meta">
    <span class="name">{file.name}</span>
    <span class="detail">{file.pages} page{file.pages === 1 ? '' : 's'} · {formatBytes(file.size)}</span>
  </div>
  <button type="button" class="quiet" onclick={onClear}>Choose another file</button>
</div>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .meta {
    display: grid;
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
