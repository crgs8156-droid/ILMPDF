import type { Component } from 'svelte';
import MergeTool from './MergeTool.svelte';
import SplitTool from './SplitTool.svelte';
import OrganizeTool from './OrganizeTool.svelte';
import ImagesToPdfTool from './ImagesToPdfTool.svelte';
import PdfToImagesTool from './PdfToImagesTool.svelte';
import PageNumbersTool from './PageNumbersTool.svelte';
import HeaderFooterTool from './HeaderFooterTool.svelte';
import WatermarkTool from './WatermarkTool.svelte';
import MetadataTool from './MetadataTool.svelte';
import UnlockTool from './UnlockTool.svelte';
import ProtectTool from './ProtectTool.svelte';
import RepairTool from './RepairTool.svelte';
import CompressTool from './CompressTool.svelte';
import FormsTool from './FormsTool.svelte';
import SignTool from './SignTool.svelte';
import CropTool from './CropTool.svelte';
import PdfToTextTool from './PdfToTextTool.svelte';
import AnnotateTool from './AnnotateTool.svelte';
import RedactTool from './RedactTool.svelte';
import SanitizeTool from './SanitizeTool.svelte';
import OcrTool from './OcrTool.svelte';
import PageToolsTool from './PageToolsTool.svelte';
import FlattenTool from './FlattenTool.svelte';
import CompareTool from './CompareTool.svelte';

export type Tool = { id: string; name: string; blurb: string; group: string; component: Component };

export const TOOLS: Tool[] = [
  { id: 'merge', name: 'Merge PDFs', blurb: 'Combine several PDFs into one, in the order you choose.', group: 'Organize', component: MergeTool },
  { id: 'split', name: 'Split PDF', blurb: 'Cut a PDF into parts by page ranges or every N pages.', group: 'Organize', component: SplitTool },
  { id: 'organize', name: 'Organize pages', blurb: 'Reorder, rotate, delete or extract pages with thumbnails.', group: 'Organize', component: OrganizeTool },
  { id: 'page-tools', name: 'Page tools', blurb: 'Resize pages to A4, Letter and more, insert blank or other pages, or remove blank pages.', group: 'Organize', component: PageToolsTool },
  { id: 'images-to-pdf', name: 'Images to PDF', blurb: 'Turn JPG, PNG, HEIC or WebP images into a PDF.', group: 'Convert', component: ImagesToPdfTool },
  { id: 'pdf-to-images', name: 'PDF to images', blurb: 'Save pages as PNG or JPG images.', group: 'Convert', component: PdfToImagesTool },
  { id: 'pdf-to-text', name: 'PDF to text', blurb: 'Save the text of a PDF as a plain .txt file.', group: 'Convert', component: PdfToTextTool },
  { id: 'ocr', name: 'OCR (make searchable)', blurb: 'Recognise the text in scanned pages so you can search, select and copy it.', group: 'Convert', component: OcrTool },
  { id: 'compare', name: 'Compare PDFs', blurb: 'See what changed between two versions: words added and removed, and pages that look different.', group: 'Organize', component: CompareTool },
  { id: 'crop', name: 'Crop pages', blurb: 'Trim the edges of pages by drawing the area to keep.', group: 'Edit', component: CropTool },
  { id: 'page-numbers', name: 'Page numbers', blurb: 'Stamp page numbers on every page.', group: 'Edit', component: PageNumbersTool },
  { id: 'header-footer', name: 'Headers & footers', blurb: 'Add headers, footers, dates, file names and Bates numbers to pages.', group: 'Edit', component: HeaderFooterTool },
  { id: 'watermark', name: 'Watermark', blurb: 'Stamp text such as CONFIDENTIAL across every page.', group: 'Edit', component: WatermarkTool },
  { id: 'annotate', name: 'Annotate PDF', blurb: 'Add text boxes, highlights, shapes and comments to pages.', group: 'Edit', component: AnnotateTool },
  { id: 'sign', name: 'Sign PDF', blurb: 'Draw your signature or use an image of it, then place it on the page.', group: 'Edit', component: SignTool },
  { id: 'forms', name: 'Fill forms', blurb: 'Fill in a PDF form, and optionally flatten it so it can no longer be changed.', group: 'Edit', component: FormsTool },
  { id: 'flatten', name: 'Flatten PDF', blurb: 'Bake form fields and comments into the pages so they can no longer be changed.', group: 'Edit', component: FlattenTool },
  { id: 'protect', name: 'Protect PDF', blurb: 'Add a password (AES-256) so only people who know it can open the PDF.', group: 'Security', component: ProtectTool },
  { id: 'unlock', name: 'Unlock PDF', blurb: 'Remove a password you know, so the PDF opens freely.', group: 'Security', component: UnlockTool },
  { id: 'compress', name: 'Compress PDF', blurb: 'Make a PDF smaller, with a choice of how much image quality to keep.', group: 'Optimize', component: CompressTool },
  { id: 'repair', name: 'Repair PDF', blurb: 'Rebuild a damaged PDF that will not open properly.', group: 'Optimize', component: RepairTool },
  { id: 'redact', name: 'Redact PDF', blurb: 'Black out text, images and drawings for good: they are deleted from the file, not just covered.', group: 'Privacy', component: RedactTool },
  { id: 'metadata', name: 'Edit metadata', blurb: 'See, change or remove hidden author, title and app details.', group: 'Privacy', component: MetadataTool },
  { id: 'remove-scripts', name: 'Remove scripts', blurb: 'Strip JavaScript, auto-run actions and attached files that other PDF apps might run.', group: 'Privacy', component: SanitizeTool },
];
