import type { Component } from 'svelte';
import MergeTool from './MergeTool.svelte';
import SplitTool from './SplitTool.svelte';
import OrganizeTool from './OrganizeTool.svelte';
import ImagesToPdfTool from './ImagesToPdfTool.svelte';
import PdfToImagesTool from './PdfToImagesTool.svelte';
import PageNumbersTool from './PageNumbersTool.svelte';
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

export type Tool = { id: string; name: string; blurb: string; group: string; component: Component };

export const TOOLS: Tool[] = [
  { id: 'merge', name: 'Merge PDFs', blurb: 'Combine several PDFs into one, in the order you choose.', group: 'Organize', component: MergeTool },
  { id: 'split', name: 'Split PDF', blurb: 'Cut a PDF into parts by page ranges or every N pages.', group: 'Organize', component: SplitTool },
  { id: 'organize', name: 'Organize pages', blurb: 'Reorder, rotate, delete or extract pages with thumbnails.', group: 'Organize', component: OrganizeTool },
  { id: 'images-to-pdf', name: 'Images to PDF', blurb: 'Turn JPG, PNG, HEIC or WebP images into a PDF.', group: 'Convert', component: ImagesToPdfTool },
  { id: 'pdf-to-images', name: 'PDF to images', blurb: 'Save pages as PNG or JPG images.', group: 'Convert', component: PdfToImagesTool },
  { id: 'pdf-to-text', name: 'PDF to text', blurb: 'Save the text of a PDF as a plain .txt file.', group: 'Convert', component: PdfToTextTool },
  { id: 'crop', name: 'Crop pages', blurb: 'Trim the edges of pages by drawing the area to keep.', group: 'Edit', component: CropTool },
  { id: 'page-numbers', name: 'Page numbers', blurb: 'Stamp page numbers on every page.', group: 'Edit', component: PageNumbersTool },
  { id: 'watermark', name: 'Watermark', blurb: 'Stamp text such as CONFIDENTIAL across every page.', group: 'Edit', component: WatermarkTool },
  { id: 'sign', name: 'Sign PDF', blurb: 'Draw your signature or use an image of it, then place it on the page.', group: 'Edit', component: SignTool },
  { id: 'forms', name: 'Fill forms', blurb: 'Fill in a PDF form, and optionally flatten it so it can no longer be changed.', group: 'Edit', component: FormsTool },
  { id: 'protect', name: 'Protect PDF', blurb: 'Add a password (AES-256) so only people who know it can open the PDF.', group: 'Security', component: ProtectTool },
  { id: 'unlock', name: 'Unlock PDF', blurb: 'Remove a password you know, so the PDF opens freely.', group: 'Security', component: UnlockTool },
  { id: 'compress', name: 'Compress PDF', blurb: 'Make a PDF smaller, with a choice of how much image quality to keep.', group: 'Optimize', component: CompressTool },
  { id: 'repair', name: 'Repair PDF', blurb: 'Rebuild a damaged PDF that will not open properly.', group: 'Optimize', component: RepairTool },
  { id: 'metadata', name: 'Remove metadata', blurb: 'See and remove hidden author, title and app details.', group: 'Privacy', component: MetadataTool },
];
