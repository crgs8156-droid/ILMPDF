// Messages between the UI thread and the pdf-lib worker. The UI keeps its
// own copy of each file; every job receives fresh copies that are
// transferred (moved, not cloned) into the worker.
import type { CropBox, ImageInput, NumberPosition, PagePlan, PageSize, SignaturePlacement } from '../engines/pdflib-ops';
import type { InsertOptions, ResizeOptions } from '../engines/pagetools-ops';
import type { HeaderFooterOptions } from '../engines/header-footer';
import type { TextDiff } from './word-diff';
import type { MetadataEdit } from '../engines/metadata-edit';
import type { Bookmark } from '../engines/mupdf-bookmarks';
import type { CompressLevel, FormField, FormValues, NewAnnotation, PdfInfo, ProtectOptions, RedactBox, RedactOptions, SanitizeReport, TextResult } from '../engines/mupdf-ops';
import type { ImageOptions, ImageReport } from '../engines/mupdf-images';
import type { FlattenOptions } from '../engines/mupdf-flatten';
import type { OverlayOptions } from '../engines/recolor';
import type { RasterOptions } from '../engines/mupdf-recolor';

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
  | { op: 'stripMetadata'; file: Uint8Array }
  | { op: 'editMetadata'; file: Uint8Array; edit: MetadataEdit }
  | { op: 'sign'; file: Uint8Array; image: ImageInput; placements: SignaturePlacement[] }
  | { op: 'crop'; file: Uint8Array; box: CropBox; pages: number[] }
  | { op: 'resize'; file: Uint8Array; opts: ResizeOptions }
  // `files` holds the PDF to insert, if any (kept in `files` so it is moved, not copied, into the worker).
  | { op: 'insertPages'; file: Uint8Array; files: Uint8Array[]; opts: InsertOptions }
  | { op: 'headerFooter'; file: Uint8Array; opts: HeaderFooterOptions }
  | { op: 'recolorOverlay'; file: Uint8Array; opts: OverlayOptions };

export type JobRequest = { id: string; job: PdfJob };

/** Jobs for the MuPDF worker (Phase 2 engine). */
export type MupdfJob =
  | { op: 'inspect'; file: Uint8Array }
  // The password is only ever held in memory for this one job.
  | { op: 'unlock'; file: Uint8Array; password: string }
  | { op: 'protect'; file: Uint8Array; opts: ProtectOptions }
  | { op: 'repair'; file: Uint8Array }
  | { op: 'compress'; file: Uint8Array; level: CompressLevel }
  | { op: 'readForm'; file: Uint8Array }
  | { op: 'fillForm'; file: Uint8Array; values: FormValues; flatten: boolean }
  | { op: 'extractText'; file: Uint8Array }
  | { op: 'annotate'; file: Uint8Array; items: NewAnnotation[] }
  | { op: 'findText'; file: Uint8Array; text: string }
  | { op: 'redact'; file: Uint8Array; boxes: RedactBox[]; options: RedactOptions }
  | { op: 'sanitize'; file: Uint8Array }
  | { op: 'extractImages'; file: Uint8Array; opts: ImageOptions }
  | { op: 'flatten'; file: Uint8Array; opts: FlattenOptions }
  | { op: 'recolorRaster'; file: Uint8Array; opts: RasterOptions }
  // Compare PDFs: files[0] is the older version, files[1] the newer one.
  | { op: 'compareText'; files: [Uint8Array, Uint8Array] }
  | { op: 'readBookmarks'; file: Uint8Array }
  // 0-based pages to delete; everything else in the file is kept.
  | { op: 'removePages'; file: Uint8Array; pages: number[] }
  | { op: 'writeBookmarks'; file: Uint8Array; bookmarks: Bookmark[] };

export type MupdfRequest = { id: string; job: MupdfJob };

/** OCR job: `pages` are 0-based (empty = every page). */
export type OcrJob = { op: 'ocr'; file: Uint8Array; pages: number[]; skipText: boolean };

export type OcrRequest = { id: string; job: OcrJob };

/** Sent by the OCR worker before each page, so the tool can show progress. */
export type OcrProgressMessage = { id: string; progress: { done: number; total: number } };

export type JobOutput = {
  files?: Uint8Array[];
  count?: number;
  meta?: Record<string, string>;
  info?: PdfInfo;
  repaired?: boolean;
  sizes?: { before: number; after: number; images: number };
  fields?: FormField[];
  text?: TextResult;
  boxes?: RedactBox[];
  /** Names of attached files that redaction could not check (untrusted text). */
  unchecked?: string[];
  removed?: SanitizeReport;
  /** What Extract images found; the pictures themselves are in `files`. */
  extracted?: Omit<ImageReport, 'files'>;
  diff?: TextDiff & { pagesA: number; pagesB: number };
  bookmarks?: Bookmark[];
};

export type JobResult = ({ ok: true } & JobOutput & { id: string }) | { id: string; ok: false; error: string };
