// Messages between the UI thread and the pdf-lib worker. The UI keeps its
// own copy of each file; every job receives fresh copies that are
// transferred (moved, not cloned) into the worker.
import type { ImageInput, NumberPosition, PagePlan, PageSize } from '../engines/pdflib-ops';

export type PdfJob =
  | { op: 'pageCount'; file: Uint8Array }
  | { op: 'merge'; files: Uint8Array[] }
  | { op: 'pick'; file: Uint8Array; groups: number[][] }
  | { op: 'organize'; file: Uint8Array; plan: PagePlan[] }
  | { op: 'imagesToPdf'; images: ImageInput[]; size: PageSize; margin: number }
  | {
      op: 'pageNumbers';
      file: Uint8Array;
      opts: { position: NumberPosition; startAt: number; fontSize: number; format: 'n' | 'n-of-total' };
    }
  | { op: 'watermark'; file: Uint8Array; opts: { text: string; fontSize: number; opacity: number; diagonal: boolean } }
  | { op: 'readMetadata'; file: Uint8Array }
  | { op: 'stripMetadata'; file: Uint8Array };

export type JobRequest = { id: string; job: PdfJob };

export type JobOutput = { files?: Uint8Array[]; count?: number; meta?: Record<string, string> };

export type JobResult = ({ ok: true } & JobOutput & { id: string }) | { id: string; ok: false; error: string };
