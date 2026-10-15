import type { Component } from 'svelte';
import MergeTool from './MergeTool.svelte';
import SplitTool from './SplitTool.svelte';
import OrganizeTool from './OrganizeTool.svelte';
import ImagesToPdfTool from './ImagesToPdfTool.svelte';
import PdfToImagesTool from './PdfToImagesTool.svelte';
import PageNumbersTool from './PageNumbersTool.svelte';
import WatermarkTool from './WatermarkTool.svelte';
import MetadataTool from './MetadataTool.svelte';

export type Tool = { id: string; name: string; blurb: string; group: string; component: Component };

export const TOOLS: Tool[] = [
  { id: 'merge', name: 'Merge PDFs', blurb: 'Combine several PDFs into one, in the order you choose.', group: 'Organize', component: MergeTool },
  { id: 'split', name: 'Split PDF', blurb: 'Cut a PDF into parts by page ranges or every N pages.', group: 'Organize', component: SplitTool },
  { id: 'organize', name: 'Organize pages', blurb: 'Reorder, rotate, delete or extract pages with thumbnails.', group: 'Organize', component: OrganizeTool },
  { id: 'images-to-pdf', name: 'Images to PDF', blurb: 'Turn JPG, PNG, HEIC or WebP images into a PDF.', group: 'Convert', component: ImagesToPdfTool },
  { id: 'pdf-to-images', name: 'PDF to images', blurb: 'Save pages as PNG or JPG images.', group: 'Convert', component: PdfToImagesTool },
  { id: 'page-numbers', name: 'Page numbers', blurb: 'Stamp page numbers on every page.', group: 'Edit', component: PageNumbersTool },
  { id: 'watermark', name: 'Watermark', blurb: 'Stamp text such as CONFIDENTIAL across every page.', group: 'Edit', component: WatermarkTool },
  { id: 'metadata', name: 'Remove metadata', blurb: 'See and remove hidden author, title and app details.', group: 'Privacy', component: MetadataTool },
];
